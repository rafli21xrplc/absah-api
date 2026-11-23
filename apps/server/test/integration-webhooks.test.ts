import type { CreatedWebhook, Webhook, WebhookList } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let off: string;
let admin: Agent;
let otherAdmin: Agent;
let kepsek: Agent;
const URL1 = 'https://hooks.sekolah.example/absah/in?token=RAHASIA-PATH';
const create = (agent: Agent, input: object, s = school, key = uuidv7()) => agent.post('/api/v1/integrations/webhooks').set('X-School-Id', s).set('Idempotency-Key', key).send(input);
const list = async (agent: Agent, s = school) => ((await agent.get('/api/v1/integrations/webhooks').set('X-School-Id', s).expect(200)).body as WebhookList).items;
const patch = (agent: Agent, id: string, input: object, s = school) => agent.patch(`/api/v1/integrations/webhooks/${id}`).set('X-School-Id', s).set('Idempotency-Key', uuidv7()).send(input);
const remove = (agent: Agent, id: string, s = school) => agent.delete(`/api/v1/integrations/webhooks/${id}`).set('X-School-Id', s).set('Idempotency-Key', uuidv7());

async function adminOf(schoolId: string, name: string) {
  const user = await t.staff(name);
  await t.member(schoolId, user.id, 'admin');
  const agent = t.agent();
  await signIn(agent, user.email).expect(200);
  await enableTotp(agent);
  return agent;
}
const enable = (schoolId: string) => withTenant({ schoolId, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId, key: 'platform.openApi', value: true }));

beforeAll(async () => {
  [school, off] = await Promise.all([t.school('sma', 'SMA Webhook'), t.school('sma', 'SMA Tanpa Webhook')]);
  await enable(school);
  [admin, otherAdmin] = await Promise.all([adminOf(school, 'Admin Webhook'), adminOf(off, 'Admin Tanpa Webhook')]);
  const k = await t.staff('Kepsek Webhook');
  await t.member(school, k.id, 'kepsek');
  kepsek = t.agent();
  await signIn(kepsek, k.email).expect(200);
});

describe('Webhook addresses (PLT-09)', () => {
  it('registers an address, shows the secret once, and shows only the host afterwards', async () => {
    const res = await create(admin, { url: URL1, events: ['attendance.absent_marked', 'leave.approved'] }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const created = res.body as CreatedWebhook;
    expect(created).toMatchObject({ urlPreview: 'https://hooks.sekolah.example', events: ['attendance.absent_marked', 'leave.approved'], active: true });
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const items = await list(admin);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toMatch(/RAHASIA-PATH|whsec_/);
    expect(Object.keys(items[0] ?? {})).not.toContain('secret');
  });

  it('stores the address and the secret encrypted, readable by the worker', async () => {
    const [id] = (await list(admin)).map((w) => w.id);
    const raw = await getDb().db.execute<{ url: string; secret: string }>(sql`select url, secret from webhook_endpoints where id = ${id}`);
    expect(raw.rows[0]?.url).not.toContain('hooks.sekolah.example');
    expect(raw.rows[0]?.secret).not.toContain('whsec_');
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, id ?? '')));
    expect(row?.url.reveal()).toBe(URL1);
    expect(row?.secret.reveal()).toMatch(/^whsec_/);
  });

  it('refuses http, credentials, other ports, private hosts, no events, unknown events and extra fields', async () => {
    const events = ['leave.approved'];
    await create(admin, { url: 'http://hooks.example/in', events }).expect(400);
    await create(admin, { url: 'https://u:p@hooks.example/in', events }).expect(400);
    await create(admin, { url: 'bukan alamat', events }).expect(400);
    for (const url of ['https://localhost/in', 'https://127.0.0.1/in', 'https://169.254.169.254/latest', 'https://10.0.0.5/in', 'https://[::1]/in', 'https://intranet/in', 'https://hooks.example:8443/in']) {
      const res = await create(admin, { url, events }).expect(400);
      expect((res.body as { details: { reason: string } }).details.reason).toMatch(/private_host|port/);
    }
    await create(admin, { url: URL1, events: [] }).expect(400);
    await create(admin, { url: URL1, events: ['student.created'] }).expect(400);
    await create(admin, { url: URL1, events, active: false }).expect(400);
    expect(await list(admin)).toHaveLength(1);
  });

  it('a retry with the same Idempotency-Key returns the same secret, not a second address', async () => {
    const key = uuidv7();
    const before = (await list(admin)).length;
    const first = await create(admin, { url: 'https://satu.example/in', events: ['leave.cancelled'] }, school, key).expect(201);
    const again = await create(admin, { url: 'https://satu.example/in', events: ['leave.cancelled'] }, school, key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as CreatedWebhook).secret).toBe((first.body as CreatedWebhook).secret);
    expect((await list(admin)).length).toBe(before + 1);
  });

  it('changes events and switches off; a new address is checked like the first one; the secret stays', async () => {
    const [target] = await list(admin);
    const id = target?.id ?? '';
    const off1 = (await patch(admin, id, { active: false }).expect(200)).body as Webhook;
    expect(off1.active).toBe(false);
    const events = (await patch(admin, id, { events: ['attendance.session_locked', 'attendance.session_locked'] }).expect(200)).body as Webhook;
    expect(events.events).toEqual(['attendance.session_locked']);
    await patch(admin, id, { url: 'https://127.0.0.1/in' }).expect(400);
    await patch(admin, id, {}).expect(400);
    await patch(admin, id, { secret: 'x' }).expect(400);
    const moved = (await patch(admin, id, { url: 'https://baru.sekolah.example/in' }).expect(200)).body as Webhook;
    expect(moved.urlPreview).toBe('https://baru.sekolah.example');
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, id)));
    expect(row?.secret.reveal()).toMatch(/^whsec_/);
    await patch(admin, uuidv7(), { active: true }).expect(404);
  });

  it('deletes an address; a second delete is 404', async () => {
    const made = (await create(admin, { url: 'https://hapus.example/in', events: ['leave.approved'] }).expect(201)).body as CreatedWebhook;
    await remove(admin, made.id).expect(204);
    await remove(admin, made.id).expect(404);
    expect((await list(admin)).map((w) => w.id)).not.toContain(made.id);
  });

  it('stops at five addresses; deleting one makes room', async () => {
    for (let i = (await list(admin)).length; i < 5; i++) await create(admin, { url: `https://sistem${i}.example/in`, events: ['leave.approved'] }).expect(201);
    const full = await create(admin, { url: 'https://keenam.example/in', events: ['leave.approved'] }).expect(409);
    expect((full.body as { details: { reason: string } }).details.reason).toBe('too_many');
    const [one] = await list(admin);
    await remove(admin, one?.id ?? '').expect(204);
    await create(admin, { url: 'https://muat-lagi.example/in', events: ['leave.approved'] }).expect(201);
  });

  it('audits the changes with the host and events, never the path or the secret', async () => {
    const rows = await getDb().db.execute<{ action: string; after: string | null }>(sql`select action, after::text as after from audit_logs where school_id = ${school} and action like 'integration.webhook%'`);
    expect(new Set(rows.rows.map((r) => r.action))).toEqual(new Set(['integration.webhook_created', 'integration.webhook_updated', 'integration.webhook_deleted']));
    const text = JSON.stringify(rows.rows);
    expect(text).toContain('hooks.sekolah.example');
    expect(text).not.toMatch(/RAHASIA-PATH|whsec_/);
  });

  it('only the admin, only where the school has the open API, and one school never sees another\'s addresses', async () => {
    await kepsek.get('/api/v1/integrations/webhooks').set('X-School-Id', school).expect(403);
    await create(kepsek, { url: URL1, events: ['leave.approved'] }).expect(403);
    const [mine] = await list(admin);
    await patch(kepsek, mine?.id ?? '', { active: false }).expect(403);
    await remove(kepsek, mine?.id ?? '').expect(403);
    const disabled = await otherAdmin.get('/api/v1/integrations/webhooks').set('X-School-Id', off).expect(404);
    expect((disabled.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    await create(otherAdmin, { url: URL1, events: ['leave.approved'] }, off).expect(404);
    await otherAdmin.get('/api/v1/integrations/webhooks').set('X-School-Id', school).expect(403);
    await t.agent().get('/api/v1/integrations/webhooks').set('X-School-Id', school).expect(401);
  });

  it('another school\'s admin cannot change or delete this school\'s address, even with the id', async () => {
    await enable(off);
    const [mine] = await list(admin);
    await patch(otherAdmin, mine?.id ?? '', { active: false }, off).expect(404);
    await remove(otherAdmin, mine?.id ?? '', off).expect(404);
    expect((await list(admin)).map((w) => w.id)).toContain(mine?.id);
  });

  it('the app role cannot change the secret or the owner', async () => {
    const [mine] = await list(admin);
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.webhookEndpoints).set({ secret: schema.webhookEndpoints.secret }).where(eq(schema.webhookEndpoints.id, mine?.id ?? '')))).rejects.toThrow();
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.webhookEndpoints).set({ active: true }).where(eq(schema.webhookEndpoints.id, mine?.id ?? '')))).resolves.toBeDefined();
  });
});
