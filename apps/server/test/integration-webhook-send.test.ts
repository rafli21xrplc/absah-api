import type { CreatedWebhook } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeWebhookSender, signWebhook, webhookConsumers, WebhookSendError } from '../src/modules/integration';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let closed: string;
let admin: Agent;
const sender = new FakeWebhookSender();
const consumers = webhookConsumers(sender);
const named = (name: string): Consumer => {
  const c = consumers.find((x) => x.name === name);
  if (!c) throw new Error(`consumer ${name} missing`);
  return c;
};
const ids: Record<string, string> = {};
const secrets: Record<string, string> = {};

const register = async (label: string, host: string, events: string[]) => {
  const res = await admin.post('/api/v1/integrations/webhooks').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ url: `https://${host}/in?token=RAHASIA-${label}`, events }).expect(201);
  ids[label] = (res.body as CreatedWebhook).id;
  secrets[label] = (res.body as CreatedWebhook).secret;
};
const event = (type: string, payload: object, schoolId = school, id = uuidv7()) => ({ id, schoolId, type, payload, traceId: null, occurredAt: new Date().toISOString() });
const absent = (id = uuidv7()) => event('attendance.absent_marked', { sessionId: uuidv7(), enrollmentId: uuidv7() }, school, id);
const fanOutAbsent = () => named('integration_webhook_absent_marked');
const send = (deliveryId: string, delivery = { attempt: 0, lastAttempt: false }) => runConsumer(named('integration_webhook_send'), event('webhook.delivery_requested', { deliveryId }), delivery);
const deliveries = (s = school) => withTenant({ schoolId: s, userId: null }, (tx) => tx.select().from(schema.webhookDeliveries).orderBy(schema.webhookDeliveries.createdAt));
const requested = async (s = school) => (await getDb().db.execute<{ delivery: string }>(sql`select payload->>'deliveryId' as delivery from outbox_events where type = 'webhook.delivery_requested' and school_id = ${s}`)).rows.map((r) => r.delivery);
const enable = (schoolId: string) => withTenant({ schoolId, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId, key: 'platform.openApi', value: true }));

beforeAll(async () => {
  [school, closed] = await Promise.all([t.school('sma', 'SMA Pengirim Webhook'), t.school('sma', 'SMA Webhook Ditutup')]);
  await enable(school);
  const user = await t.staff('Admin Pengirim');
  await t.member(school, user.id, 'admin');
  admin = t.agent();
  await signIn(admin, user.email).expect(200);
  await enableTotp(admin);
  await register('abs', 'abs.example', ['attendance.absent_marked']);
  await register('both', 'both.example', ['attendance.absent_marked', 'leave.approved']);
  await register('leave', 'leave.example', ['leave.approved']);
  await admin.patch(`/api/v1/integrations/webhooks/${ids.leave}`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ active: false }).expect(200);
});

describe('Webhook fan-out (PLT-09)', () => {
  it('stores one call per active address that wants the event, and asks for each to be sent', async () => {
    await runConsumer(fanOutAbsent(), absent());
    const rows = await deliveries();
    expect(rows.map((r) => r.endpointId).sort()).toEqual([ids.abs, ids.both].sort());
    expect(rows.every((r) => r.status === 'pending' && r.eventType === 'attendance.absent_marked')).toBe(true);
    expect((await requested()).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('a redelivered event, or the same event handled twice, adds nothing', async () => {
    const e = absent();
    await runConsumer(fanOutAbsent(), e);
    const after = (await deliveries()).length;
    expect(await runConsumer(fanOutAbsent(), e)).toBe('duplicate');
    expect((await deliveries()).length).toBe(after);
    // Even past the consumption mark, the unique (endpoint, event) keeps one call.
    await withTenant({ schoolId: school, userId: null }, (tx) => fanOutAbsent().handle(tx, { ...e, type: 'attendance.absent_marked', payload: e.payload as { sessionId: string; enrollmentId: string } }, { attempt: 0, lastAttempt: false }));
    expect((await deliveries()).length).toBe(after);
  });

  it('sends nothing for a school without the open API, and nothing to another school\'s addresses', async () => {
    const before = (await deliveries()).length;
    await runConsumer(fanOutAbsent(), event('attendance.absent_marked', { sessionId: uuidv7(), enrollmentId: uuidv7() }, closed));
    expect(await deliveries(closed)).toHaveLength(0);
    expect((await deliveries()).length).toBe(before);
    // Switched off after the addresses were made: the calls stop too.
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.schoolCapabilities).set({ value: false }).where(eq(schema.schoolCapabilities.schoolId, school)));
    await runConsumer(fanOutAbsent(), absent());
    expect((await deliveries()).length).toBe(before);
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.schoolCapabilities).set({ value: true }).where(eq(schema.schoolCapabilities.schoolId, school)));
  });

  it('every event type of the open API has a fan-out, and the payload is ids only', async () => {
    const types = consumers.filter((c) => c.name !== 'integration_webhook_send').map((c) => c.event).sort();
    expect(types).toEqual(['attendance.absent_marked', 'attendance.session_locked', 'leave.approved', 'leave.cancelled']);
    await runConsumer(named('integration_webhook_leave_approved'), event('leave.approved', { leaveRequestId: uuidv7() }));
    const leave = (await deliveries()).filter((r) => r.eventType === 'leave.approved');
    expect(leave.map((r) => r.endpointId)).toEqual([ids.both]); // 'leave' is switched off
    expect(Object.keys(leave[0]?.payload as object)).toEqual(['leaveRequestId']);
  });
});

describe('Webhook sending (PLT-09)', () => {
  it('posts the signed body: ids only, our delivery id, a signature the receiver can check', async () => {
    const [row] = (await deliveries()).filter((r) => r.endpointId === ids.abs);
    const before = sender.calls.length;
    await send(row?.id ?? '');
    const call = sender.calls[before];
    expect(call).toBeDefined();
    expect(call?.url).toBe('https://abs.example/in?token=RAHASIA-abs');
    expect(call?.deliveryId).toBe(row?.id);
    expect(call?.secret).toBe(secrets.abs);
    const body = JSON.parse(call?.body ?? '{}') as { id: string; type: string; schoolId: string; data: object };
    expect(body).toMatchObject({ id: row?.eventId, type: 'attendance.absent_marked', schoolId: school });
    expect(Object.keys(body.data).sort()).toEqual(['enrollmentId', 'sessionId']);
    expect(signWebhook(call?.secret ?? '', call?.timestamp ?? 0, call?.body ?? '')).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    const [after] = (await deliveries()).filter((r) => r.id === row?.id);
    expect(after).toMatchObject({ status: 'delivered', attempts: 1, lastStatus: 200, lastError: null });
    expect(after?.finishedAt).toBeInstanceOf(Date);
    // A second event for the same call (or a redelivery with a new job) finds it finished and posts nothing.
    const posted = sender.calls.length;
    await send(row?.id ?? '');
    expect(sender.calls.length).toBe(posted);
    // The very same event twice is skipped by the consumption mark.
    const same = event('webhook.delivery_requested', { deliveryId: row?.id ?? '' });
    await runConsumer(named('integration_webhook_send'), same);
    expect(await runConsumer(named('integration_webhook_send'), same)).toBe('duplicate');
    expect(sender.calls.length).toBe(posted);
  });

  it('a receiver that is down is retried (the write rolls back) and fails for good only on the last attempt', async () => {
    const [row] = (await deliveries()).filter((r) => r.endpointId === ids.both && r.status === 'pending');
    sender.answers.set('both.example', 503);
    await expect(send(row?.id ?? '', { attempt: 0, lastAttempt: false })).rejects.toThrow(/will retry/);
    expect((await deliveries()).find((r) => r.id === row?.id)).toMatchObject({ status: 'pending', attempts: 0 });
    await send(row?.id ?? '', { attempt: 5, lastAttempt: true });
    expect((await deliveries()).find((r) => r.id === row?.id)).toMatchObject({ status: 'failed', attempts: 6, lastStatus: 503, lastError: 'http_503' });
    sender.answers.delete('both.example');
  });

  it('a final answer (404) fails at once, without retries; network errors retry like a 5xx', async () => {
    await runConsumer(fanOutAbsent(), absent());
    const [a, b] = (await deliveries()).filter((r) => r.endpointId === ids.abs && r.status === 'pending');
    sender.answers.set('abs.example', 404);
    await send(a?.id ?? '');
    expect((await deliveries()).find((r) => r.id === a?.id)).toMatchObject({ status: 'failed', lastStatus: 404, lastError: 'http_404', attempts: 1 });
    sender.answers.set('abs.example', new WebhookSendError('x', 'network'));
    await expect(send(b?.id ?? '')).rejects.toThrow(/will retry/);
    await send(b?.id ?? '', { attempt: 5, lastAttempt: true });
    expect((await deliveries()).find((r) => r.id === b?.id)).toMatchObject({ status: 'failed', lastStatus: null, lastError: 'network' });
    sender.answers.delete('abs.example');
  });

  it('a blocked address is never retried', async () => {
    await runConsumer(fanOutAbsent(), absent());
    const [row] = (await deliveries()).filter((r) => r.endpointId === ids.abs && r.status === 'pending');
    sender.answers.set('abs.example', new WebhookSendError('x', 'blocked'));
    await send(row?.id ?? '');
    expect((await deliveries()).find((r) => r.id === row?.id)).toMatchObject({ status: 'failed', lastError: 'blocked_address' });
    sender.answers.delete('abs.example');
  });

  it('an address switched off after the call was stored sends nothing and says why', async () => {
    await runConsumer(fanOutAbsent(), absent());
    const [row] = (await deliveries()).filter((r) => r.endpointId === ids.both && r.status === 'pending');
    await admin.patch(`/api/v1/integrations/webhooks/${ids.both}`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ active: false }).expect(200);
    const before = sender.calls.length;
    await send(row?.id ?? '');
    expect(sender.calls.length).toBe(before);
    expect((await deliveries()).find((r) => r.id === row?.id)).toMatchObject({ status: 'failed', lastError: 'endpoint_off' });
  });

  it('deleting an address removes its calls; the app role cannot rewrite what a call said', async () => {
    const mine = (await deliveries()).filter((r) => r.endpointId === ids.abs);
    expect(mine.length).toBeGreaterThan(0);
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.webhookDeliveries).set({ payload: { x: 1 } }).where(eq(schema.webhookDeliveries.id, mine[0]?.id ?? '')))).rejects.toThrow();
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, mine[0]?.id ?? '')))).rejects.toThrow();
    await admin.delete(`/api/v1/integrations/webhooks/${ids.abs}`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).expect(204);
    expect((await deliveries()).filter((r) => r.endpointId === ids.abs)).toHaveLength(0);
  });
});
