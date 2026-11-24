import type { ApiKey, ApiKeyList, CreatedApiKey } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKeyHash, parseApiKey } from '../src/shared/api-keys';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let off: string;
let admin: Agent;
let otherAdmin: Agent;
let kepsek: Agent;
const body = (res: { body: unknown }) => res.body;
const create = (agent: Agent, input: object, s = school, key = uuidv7()) => agent.post('/api/v1/integrations/api-keys').set('X-School-Id', s).set('Idempotency-Key', key).send(input);
const list = async (agent: Agent, s = school) => ((await agent.get('/api/v1/integrations/api-keys').set('X-School-Id', s).expect(200)).body as ApiKeyList).items;

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
  [school, off] = await Promise.all([t.school('sma', 'SMA API Terbuka'), t.school('sma', 'SMA Tanpa API')]);
  await enable(school);
  [admin, otherAdmin] = await Promise.all([adminOf(school, 'Admin API'), adminOf(off, 'Admin Tanpa API')]);
  const k = await t.staff('Kepsek API');
  await t.member(school, k.id, 'kepsek');
  kepsek = t.agent();
  await signIn(kepsek, k.email).expect(200);
});

describe('API keys of the open API (PLT-09)', () => {
  it('creates a key, shows it once and never again; only the hash is stored', async () => {
    const res = await create(admin, { name: 'Aplikasi Orang Tua', scopes: ['attendance:read'], rateLimitPerMinute: 120 }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const created = res.body as CreatedApiKey;
    expect(created).toMatchObject({ name: 'Aplikasi Orang Tua', scopes: ['attendance:read'], rateLimitPerMinute: 120, lastUsedAt: null, revokedAt: null });
    expect(created.key).toMatch(new RegExp(`^abk_${school}\\.[A-Za-z0-9_-]{43}$`));

    const items = await list(admin);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain(created.key.split('.')[1] ?? 'x');
    expect(Object.keys(items[0] ?? {})).not.toContain('key');

    const parsed = parseApiKey(created.key);
    expect(parsed?.schoolId).toBe(school);
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, created.id)));
    expect(row?.tokenHash).toBe(apiKeyHash(parsed?.secret ?? ''));
    expect(row?.tokenHash).not.toContain(parsed?.secret ?? 'x');
  });

  it('uses the default rate limit when none is given and refuses a bad name, scope or rate', async () => {
    const ok = (await create(admin, { name: 'Dashboard Dinas', scopes: ['attendance:read'] }).expect(201)).body as CreatedApiKey;
    expect(ok.rateLimitPerMinute).toBe(60);
    await create(admin, { name: 'x', scopes: ['attendance:read'] }).expect(400);
    await create(admin, { name: 'Tanpa izin', scopes: [] }).expect(400);
    await create(admin, { name: 'Izin asing', scopes: ['students:write'] }).expect(400);
    await create(admin, { name: 'Terlalu cepat', scopes: ['attendance:read'], rateLimitPerMinute: 100000 }).expect(400);
    await create(admin, { name: 'Terlalu lambat', scopes: ['attendance:read'], rateLimitPerMinute: 1 }).expect(400);
    await create(admin, { name: 'Ekstra', scopes: ['attendance:read'], owner: 'x' }).expect(400);
  });

  it('a retry with the same Idempotency-Key gives the same key, not a second one', async () => {
    const key = uuidv7();
    const before = (await list(admin)).length;
    const first = await create(admin, { name: 'Sekali saja', scopes: ['attendance:read'] }, school, key).expect(201);
    const again = await create(admin, { name: 'Sekali saja', scopes: ['attendance:read'] }, school, key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as CreatedApiKey).key).toBe((first.body as CreatedApiKey).key);
    expect((await list(admin)).length).toBe(before + 1);
  });

  it('revokes at once; revoking again changes nothing and keeps the first time', async () => {
    const made = (await create(admin, { name: 'Akan dicabut', scopes: ['attendance:read'] }).expect(201)).body as CreatedApiKey;
    const revoke = () => admin.post(`/api/v1/integrations/api-keys/${made.id}/revoke`).set('X-School-Id', school).set('Idempotency-Key', uuidv7());
    const first = (await revoke().expect(200)).body as ApiKey;
    expect(first.revokedAt).not.toBeNull();
    const second = (await revoke().expect(200)).body as ApiKey;
    expect(second.revokedAt).toBe(first.revokedAt);
    await admin.post(`/api/v1/integrations/api-keys/${uuidv7()}/revoke`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).expect(404);
  });

  it('stops at ten active keys; revoking one makes room', async () => {
    const active = (await list(admin)).filter((k) => !k.revokedAt);
    for (let i = active.length; i < 10; i++) await create(admin, { name: `Kunci ${i}`, scopes: ['attendance:read'] }).expect(201);
    const full = await create(admin, { name: 'Kesebelas', scopes: ['attendance:read'] }).expect(409);
    expect((body(full) as { details: { reason: string } }).details.reason).toBe('too_many');
    const [one] = (await list(admin)).filter((k) => !k.revokedAt);
    await admin.post(`/api/v1/integrations/api-keys/${one?.id}/revoke`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).expect(200);
    await create(admin, { name: 'Muat lagi', scopes: ['attendance:read'] }).expect(201);
  });

  it('audits the creation and the revocation without the key', async () => {
    // Read as the login role: the audit log is readable only by admins through RLS, and this is about what is in it.
    const rows = await getDb().db.execute<{ action: string; after: string | null }>(sql`select action, after::text as after from audit_logs where school_id = ${school} and action like 'integration.api_key%'`);
    const actions = new Set(rows.rows.map((r) => r.action));
    expect(actions).toEqual(new Set(['integration.api_key_created', 'integration.api_key_revoked']));
    expect(rows.rows.find((r) => r.action === 'integration.api_key_created')?.after).toContain('attendance:read');
    expect(JSON.stringify(rows.rows)).not.toMatch(/abk_/);
  });

  it('only the admin, only where the school has the open API, and one school never sees another\'s keys', async () => {
    await kepsek.get('/api/v1/integrations/api-keys').set('X-School-Id', school).expect(403);
    await create(kepsek, { name: 'Tidak boleh', scopes: ['attendance:read'] }).expect(403);
    const disabled = await otherAdmin.get('/api/v1/integrations/api-keys').set('X-School-Id', off).expect(404);
    expect((body(disabled) as { code: string }).code).toBe('CAPABILITY_DISABLED');
    await create(otherAdmin, { name: 'Tidak aktif', scopes: ['attendance:read'] }, off).expect(404);
    await otherAdmin.get('/api/v1/integrations/api-keys').set('X-School-Id', school).expect(403);
  });

  it('the app role cannot change what a key may do, nor delete it', async () => {
    const [anyKey] = await list(admin);
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.apiKeys).set({ scopes: ['attendance:read', 'x'] }).where(eq(schema.apiKeys.id, anyKey?.id ?? '')))).rejects.toThrow();
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.apiKeys).where(eq(schema.apiKeys.id, anyKey?.id ?? '')))).rejects.toThrow();
    // Control: the allowed columns do update.
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, anyKey?.id ?? '')));
  });
});
