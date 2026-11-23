import type { CreatedWebhook, WebhookDeliveryList, WebhookTestQueued } from '@absah/contracts';
import { schema } from '@absah/db';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeWebhookSender, webhookConsumers, WebhookSendError } from '../src/modules/integration';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let off: string;
let admin: Agent;
let otherAdmin: Agent;
let kepsek: Agent;
let hook: string;
let otherHook: string;
const sender = new FakeWebhookSender();
const send = (deliveryId: string, delivery = { attempt: 0, lastAttempt: false }) => {
  const consumer = webhookConsumers(sender).find((c) => c.name === 'integration_webhook_send');
  if (!consumer) throw new Error('consumer missing');
  return runConsumer(consumer, { id: uuidv7(), schoolId: school, type: 'webhook.delivery_requested', payload: { deliveryId }, traceId: null, occurredAt: new Date().toISOString() }, delivery);
};
const ping = (agent: Agent, id: string, s = school, key = uuidv7()) => agent.post(`/api/v1/integrations/webhooks/${id}/test`).set('X-School-Id', s).set('Idempotency-Key', key);
const deliveries = async (agent: Agent, id: string, s = school) => ((await agent.get(`/api/v1/integrations/webhooks/${id}/deliveries`).set('X-School-Id', s).expect(200)).body as WebhookDeliveryList).items;
const register = async (agent: Agent, s: string, host: string) =>
  ((await agent.post('/api/v1/integrations/webhooks').set('X-School-Id', s).set('Idempotency-Key', uuidv7()).send({ url: `https://${host}/in?token=RAHASIA`, events: ['leave.approved'] }).expect(201)).body as CreatedWebhook).id;

async function adminOf(schoolId: string, name: string) {
  const user = await t.staff(name);
  await t.member(schoolId, user.id, 'admin');
  const agent = t.agent();
  await signIn(agent, user.email).expect(200);
  await enableTotp(agent);
  return agent;
}

beforeAll(async () => {
  [school, other, off] = await Promise.all([t.school('sma', 'SMA Tes Webhook'), t.school('sma', 'SMA Tes Lain'), t.school('sma', 'SMA Tes Tertutup')]);
  for (const s of [school, other]) await withTenant({ schoolId: s, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId: s, key: 'platform.openApi', value: true }));
  [admin, otherAdmin] = await Promise.all([adminOf(school, 'Admin Tes'), adminOf(other, 'Admin Tes Lain')]);
  const k = await t.staff('Kepsek Tes');
  await t.member(school, k.id, 'kepsek');
  kepsek = t.agent();
  await signIn(kepsek, k.email).expect(200);
  hook = await register(admin, school, 'tes.example');
  otherHook = await register(otherAdmin, other, 'lain.example');
});

describe('Webhook test ping (PLT-09)', () => {
  it('queues one signed ping, which the worker sends and the list then shows as delivered', async () => {
    const res = await ping(admin, hook).expect(202);
    const { deliveryId } = res.body as WebhookTestQueued;
    const [waiting] = await deliveries(admin, hook);
    expect(waiting).toMatchObject({ id: deliveryId, eventType: 'webhook.test', status: 'pending', attempts: 0, lastStatus: null, lastError: null, finishedAt: null });

    const queued = await getDb().db.execute<{ n: number }>(sql`select count(*)::int as n from outbox_events where type = 'webhook.delivery_requested' and school_id = ${school} and payload->>'deliveryId' = ${deliveryId}`);
    expect(queued.rows[0]?.n).toBe(1);
    expect(sender.calls).toHaveLength(0); // nothing left the request handler

    await send(deliveryId);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({ eventType: 'webhook.test', deliveryId });
    expect(JSON.parse(sender.calls[0]?.body ?? '{}')).toMatchObject({ type: 'webhook.test', schoolId: school, data: {} });
    expect((await deliveries(admin, hook))[0]).toMatchObject({ status: 'delivered', attempts: 1, lastStatus: 200 });
  });

  it('shows why a ping failed, without the receiver\'s answer or the body', async () => {
    const { deliveryId } = (await ping(admin, hook).expect(202)).body as WebhookTestQueued;
    sender.answers.set('tes.example', new WebhookSendError('x', 'blocked'));
    await send(deliveryId);
    sender.answers.delete('tes.example');
    const [row] = await deliveries(admin, hook);
    expect(row).toMatchObject({ status: 'failed', lastError: 'blocked_address' });
    expect(Object.keys(row ?? {}).sort()).toEqual(['attempts', 'createdAt', 'eventType', 'finishedAt', 'id', 'lastError', 'lastStatus', 'status']);
  });

  it('one ping at a time: a second while the first waits is 409, a stuck one (over 10 minutes) no longer blocks', async () => {
    const first = (await ping(admin, hook).expect(202)).body as WebhookTestQueued;
    const again = await ping(admin, hook).expect(409);
    expect((again.body as { details: { reason: string } }).details.reason).toBe('already_pending');
    await getDb().db.execute(sql`update webhook_deliveries set created_at = now() - interval '11 minutes' where id = ${first.deliveryId}`);
    await ping(admin, hook).expect(202);
  });

  it('a retry with the same Idempotency-Key is the same ping, not a second one', async () => {
    const fresh = await register(admin, school, 'tunggal.example');
    const key = uuidv7();
    const a = await ping(admin, fresh, school, key).expect(202);
    const b = await ping(admin, fresh, school, key).expect(202);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect((b.body as WebhookTestQueued).deliveryId).toBe((a.body as WebhookTestQueued).deliveryId);
    expect(await deliveries(admin, fresh)).toHaveLength(1);
  });

  it('a switched-off address is 409 inactive; an unknown or another school\'s address is 404', async () => {
    const quiet = await register(admin, school, 'mati.example');
    await admin.patch(`/api/v1/integrations/webhooks/${quiet}`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ active: false }).expect(200);
    expect(((await ping(admin, quiet).expect(409)).body as { details: { reason: string } }).details.reason).toBe('inactive');
    await ping(admin, uuidv7()).expect(404);
    await ping(admin, otherHook).expect(404);
    await admin.get(`/api/v1/integrations/webhooks/${otherHook}/deliveries`).set('X-School-Id', school).expect(404);
    await ping(admin, 'bukan-uuid').expect(400);
  });

  it('only the admin, only where the school has the open API; the other school sees none of it', async () => {
    await ping(kepsek, hook).expect(403);
    await kepsek.get(`/api/v1/integrations/webhooks/${hook}/deliveries`).set('X-School-Id', school).expect(403);
    await t.agent().post(`/api/v1/integrations/webhooks/${hook}/test`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).expect(401);
    const closed = await adminOf(off, 'Admin Tes Tertutup');
    expect(((await ping(closed, hook, off).expect(404)).body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    expect(await deliveries(otherAdmin, otherHook, other)).toEqual([]);
  });

  it('is audited with the host only, never the path or the secret', async () => {
    const rows = await getDb().db.execute<{ after: string | null }>(sql`select after::text as after from audit_logs where school_id = ${school} and action = 'integration.webhook_tested'`);
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows[0]?.after).toContain('tes.example');
    expect(JSON.stringify(rows.rows)).not.toMatch(/RAHASIA|whsec_/);
  });
});
