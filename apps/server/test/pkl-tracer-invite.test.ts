import type { InviteTracerResult, TracerAlumnus } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyConsumers } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const APP = 'https://app.absah.test';
let school: string;
let humas: Agent;
let kepsek: Agent;
const ids: Record<string, string> = {};
const phones: Record<string, string> = { dewi: testPhone(), eko: testPhone() };

const invite = (agent: Agent, body: object, s = school) => agent.post('/api/v1/tracer/invitations').set('X-School-Id', s).set('Idempotency-Key', uuidv7()).send(body);
const events = async () => (await getDb().db.execute<{ id: string; alumnus: string }>(sql`select id, payload->>'alumnusId' as alumnus from outbox_events where type = 'tracer.invitation_requested' and school_id = ${school}`)).rows;
const add = async (name: string, phoneNumber?: string) => ((await humas.post('/api/v1/tracer/alumni').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ name, graduationYear: 2026, ...(phoneNumber ? { phoneNumber } : {}) }).expect(201)).body as TracerAlumnus).id;

beforeAll(async () => {
  school = await t.school('smk', 'SMK Undangan Alumni');
  for (const [label, role] of [['humas', 'humas_pkl'], ['kepsek', 'kepsek']] as const) {
    const u = await t.staff(`Undangan ${label}`);
    await t.member(school, u.id, role);
    const agent = t.agent();
    await signIn(agent, u.email).expect(200);
    if (label === 'humas') humas = agent;
    else kepsek = agent;
  }
  ids.dewi = await add('Dewi Sartika', phones.dewi);
  ids.eko = await add('Eko Prasetyo', phones.eko);
  ids.fajar = await add('Fajar Nugroho'); // no number
  ids.gita = await add('Gita Permata', testPhone());
  await humas.put(`/api/v1/tracer/alumni/${ids.gita}/response`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ status: 'bekerja', organization: 'PT Maju' }).expect(200);
});

describe('Tracer study invitations (PKL-05)', () => {
  it('invites a whole angkatan: only those with a number and no answer yet, and says why the rest were skipped', async () => {
    const res = await invite(humas, { graduationYear: 2026 }).expect(202);
    expect(res.body as InviteTracerResult).toEqual({ queued: 2, withoutPhone: 1, alreadyAnswered: 1 });
    expect((await events()).map((e) => e.alumnus).sort()).toEqual([ids.dewi, ids.eko].sort());
  });

  it('with resend the ones who answered are invited again; listed ids must exist in this school', async () => {
    expect((await invite(humas, { alumnusIds: [ids.gita], resend: true }).expect(202)).body).toEqual({ queued: 1, withoutPhone: 0, alreadyAnswered: 0 });
    expect((await invite(humas, { alumnusIds: [ids.gita] }).expect(202)).body).toEqual({ queued: 0, withoutPhone: 0, alreadyAnswered: 1 });
    await invite(humas, { alumnusIds: [uuidv7()] }).expect(404);
  });

  it('needs either a list or an angkatan, not both and not neither; only the BKK invites', async () => {
    await invite(humas, {}).expect(400);
    await invite(humas, { alumnusIds: [ids.dewi], graduationYear: 2026 }).expect(400);
    await invite(humas, { alumnusIds: [] }).expect(400);
    await invite(kepsek, { graduationYear: 2026 }).expect(403);
  });

  it('the worker sends each alumnus their own link, once a day, and the link opens the form', async () => {
    const [consumer] = notifyConsumers({ sender: t.messageSender, appUrl: APP }).filter((c) => c.name === 'notify_tracer_invitation');
    if (!consumer) throw new Error('consumer missing');
    const eko = (await events()).find((e) => e.alumnus === ids.eko);
    const deliver = () => runConsumer(consumer, { id: eko?.id ?? uuidv7(), schoolId: school, type: 'tracer.invitation_requested', payload: { alumnusId: ids.eko ?? '' }, traceId: null, occurredAt: new Date().toISOString() });
    await deliver();
    // Another click the same day (a new event) mints and sends nothing more.
    const second = { ...(eko ?? { id: uuidv7() }), id: uuidv7() };
    await runConsumer(consumer, { id: second.id, schoolId: school, type: 'tracer.invitation_requested', payload: { alumnusId: ids.eko ?? '' }, traceId: null, occurredAt: new Date().toISOString() });

    const rows = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.templateCode, 'tracer_invitation')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toPhone.reveal()).toBe(phones.eko);
    const params = JSON.parse(rows[0]?.params.reveal() ?? '{}') as { school: string; first_name: string; url: string };
    expect(params).toMatchObject({ school: 'SMK Undangan Alumni', first_name: 'Eko' });
    expect(params.url.startsWith(`${APP}/alumni#${school}.`)).toBe(true);
    expect(JSON.stringify(params)).not.toContain('Prasetyo');

    const links = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.tracerLinks).where(eq(schema.tracerLinks.alumnusId, ids.eko ?? '')));
    expect(links).toHaveLength(1);

    const token = params.url.split('#')[1] ?? '';
    const page = await t.agent().get('/api/v1/tracer/form').set('Authorization', `Tracer ${token}`).expect(200);
    expect(page.body).toMatchObject({ firstName: 'Eko', schoolName: 'SMK Undangan Alumni' });
  });

  it('an alumnus whose number was removed gets nothing and no link', async () => {
    const [consumer] = notifyConsumers({ sender: t.messageSender, appUrl: APP }).filter((c) => c.name === 'notify_tracer_invitation');
    if (!consumer) throw new Error('consumer missing');
    await runConsumer(consumer, { id: uuidv7(), schoolId: school, type: 'tracer.invitation_requested', payload: { alumnusId: ids.fajar ?? '' }, traceId: null, occurredAt: new Date().toISOString() });
    const links = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.tracerLinks).where(eq(schema.tracerLinks.alumnusId, ids.fajar ?? '')));
    expect(links).toHaveLength(0);
  });
});
