import type { CreatedWebhook, Webhook, WebhookList } from '@absah/contracts';
import { WEBHOOK_AUTO_DISABLE_AFTER } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeWebhookSender, webhookConsumers, WebhookSendError } from '../src/modules/integration';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let admin: Agent;
const sender = new FakeWebhookSender();
const N = WEBHOOK_AUTO_DISABLE_AFTER;
const send = (deliveryId: string) => {
  const consumer = webhookConsumers(sender).find((c) => c.name === 'integration_webhook_send');
  if (!consumer) throw new Error('consumer missing');
  return runConsumer(consumer, { id: uuidv7(), schoolId: school, type: 'webhook.delivery_requested', payload: { deliveryId }, traceId: null, occurredAt: new Date().toISOString() }, { attempt: 0, lastAttempt: true });
};
const register = async (host: string) => ((await admin.post('/api/v1/integrations/webhooks').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ url: `https://${host}/in`, events: ['leave.approved'] }).expect(201)).body as CreatedWebhook).id;
const view = async (id: string) => ((await admin.get('/api/v1/integrations/webhooks').set('X-School-Id', school).expect(200)).body as WebhookList).items.find((h) => h.id === id) as Webhook;
/** One stored call, sent now; the answer of its host decides how it ends. */
async function call(endpointId: string, type = 'leave.approved') {
  const id = uuidv7();
  await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.webhookDeliveries).values({ id, schoolId: school, endpointId, eventId: uuidv7(), eventType: type, payload: {} }));
  await send(id);
  return id;
}
const failHost = (host: string) => sender.answers.set(host, 500);
const upHost = (host: string) => sender.answers.delete(host);
const audits = async () => (await getDb().db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where school_id = ${school} and action = 'integration.webhook_auto_disabled'`)).rows[0]?.n ?? 0;

// The school may hold five addresses: each test starts with none (its calls go with them).
afterEach(async () => {
  await getDb().db.execute(sql`delete from webhook_endpoints where school_id = ${school}`);
  sender.answers.clear();
});

beforeAll(async () => {
  school = await t.school('sma', 'SMA Mati Otomatis');
  await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'platform.openApi', value: true }));
  const user = await t.staff('Admin Mati Otomatis');
  await t.member(school, user.id, 'admin');
  admin = t.agent();
  await signIn(admin, user.email).expect(200);
  await enableTotp(admin);
});

describe('Switching off an address that keeps failing (PLT-09)', () => {
  it('stays on up to the last failure before the limit, then switches off by itself and audits it once', async () => {
    const id = await register('rusak.example');
    failHost('rusak.example');
    for (let i = 0; i < N - 1; i++) await call(id);
    expect(await view(id)).toMatchObject({ active: true, disabledReason: null });
    await call(id);
    expect(await view(id)).toMatchObject({ active: false, disabledReason: 'too_many_failures' });
    expect(await audits()).toBe(1);
    const row = (await getDb().db.execute<{ actor: string | null; after: string }>(sql`select actor_user_id as actor, after::text as after from audit_logs where school_id = ${school} and action = 'integration.webhook_auto_disabled'`)).rows[0];
    expect(row?.actor).toBeNull();
    expect(row?.after).toContain('too_many_failures');
    expect(row?.after).not.toMatch(/rusak\.example|whsec_/);
  });

  it('one answer in the run keeps it on; the count restarts after an answer', async () => {
    const id = await register('kadang.example');
    failHost('kadang.example');
    for (let i = 0; i < N - 1; i++) await call(id);
    upHost('kadang.example');
    await call(id); // an answer: the run is broken
    failHost('kadang.example');
    for (let i = 0; i < N - 1; i++) await call(id);
    expect(await view(id)).toMatchObject({ active: true });
  });

  it('a ping and a call refused because the address is off never count', async () => {
    const id = await register('uji.example');
    failHost('uji.example');
    for (let i = 0; i < N + 3; i++) await call(id, 'webhook.test');
    expect(await view(id)).toMatchObject({ active: true });
  });

  it('switching it on again starts the count over: it takes another full run to switch off', async () => {
    const id = await register('pulih.example');
    failHost('pulih.example');
    for (let i = 0; i < N; i++) await call(id);
    expect(await view(id)).toMatchObject({ active: false, disabledReason: 'too_many_failures' });
    const back = (await admin.patch(`/api/v1/integrations/webhooks/${id}`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ active: true }).expect(200)).body as Webhook;
    expect(back).toMatchObject({ active: true, disabledReason: null });
    for (let i = 0; i < N - 1; i++) await call(id);
    expect(await view(id)).toMatchObject({ active: true });
    await call(id);
    expect(await view(id)).toMatchObject({ active: false, disabledReason: 'too_many_failures' });
  });

  it('a switch-off by the admin carries no reason, and the app role may update the reason only through its grant', async () => {
    const id = await register('manual.example');
    const off = (await admin.patch(`/api/v1/integrations/webhooks/${id}`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ active: false }).expect(200)).body as Webhook;
    expect(off).toMatchObject({ active: false, disabledReason: null });
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.webhookEndpoints).set({ disabledReason: 'too_many_failures' }).where(eq(schema.webhookEndpoints.id, id)));
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.webhookEndpoints).set({ createdBy: null }).where(eq(schema.webhookEndpoints.id, id)))).rejects.toThrow();
  });

  it('network failures count like bad answers', async () => {
    const id = await register('putus.example');
    sender.answers.set('putus.example', new WebhookSendError('x', 'network'));
    for (let i = 0; i < N; i++) await call(id);
    expect(await view(id)).toMatchObject({ active: false, disabledReason: 'too_many_failures' });
    sender.answers.delete('putus.example');
  });
});
