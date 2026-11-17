import type { Payment, PaymentList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPaymentWebhooks, subscriptionConsumers } from '../src/modules/subscription';
import { requestPayment } from '../src/modules/subscription/application/payments';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { FAKE_SIGNATURE_HEADER, PaymentError, signFakeWebhook } from '../src/shared/payments';
import { buildTestApp, enableTotp, signIn, TEST_PAYMENT_SECRET, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let adminId: string;
let admin: Agent;
let kepsek: Agent;
let guru: Agent;
const invoices = { jan: '', feb: '', mar: '' };
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const pay = (agent: Agent, invoiceId: string, body: object, key = uuidv7()) =>
  agent.post(`/api/v1/billing/invoices/${invoiceId}/payments`).set('X-School-Id', school).set('Idempotency-Key', key).send(body);
const payments = (agent: Agent, invoiceId: string) => agent.get(`/api/v1/billing/invoices/${invoiceId}/payments`).set('X-School-Id', school);
const [consumer] = subscriptionConsumers(t.paymentProvider);
// inbox_webhooks is a platform table that outlives test schools: transaction ids unique per run.
const run = uuidv7();
const txn = (n: string) => `${n}-${run}`;

/** Runs the worker's consumer on every payment.requested event of the school not handled yet. */
async function openCharges() {
  if (!consumer) throw new Error('no consumer');
  const events = await getDb()
    .db.select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'payment.requested')))
    .orderBy(asc(schema.outboxEvents.createdAt));
  const results = [];
  for (const e of events) {
    results.push(await runConsumer(consumer, { id: e.id, schoolId: school, type: e.type, payload: e.payload, traceId: null, occurredAt: e.createdAt.toISOString() }, { attempt: 2, lastAttempt: true }));
  }
  return results;
}

/** What the fake gateway posts when money arrives (or the charge ends). */
function webhook(events: { providerRef: string; providerTxnId: string; status: 'paid' | 'expired' | 'failed'; amount: number }[], secret = TEST_PAYMENT_SECRET) {
  const raw = JSON.stringify({ events: events.map((e) => ({ ...e, at: '2027-02-03T02:00:00.000Z' })) });
  return request(t.app).post('/api/v1/webhooks/payments').set('Content-Type', 'application/json').set(FAKE_SIGNATURE_HEADER, signFakeWebhook(raw, secret)).send(raw);
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Bayar');
  const [a, k, g] = await Promise.all([t.staff('Admin Bayar'), t.staff('Kepsek Bayar'), t.staff('Guru Bayar')]);
  adminId = a.id;
  await t.member(school, a.id, 'admin');
  await t.member(school, k.id, 'kepsek');
  await t.member(school, g.id, 'guru');
  [admin, kepsek, guru] = [t.agent(), t.agent(), t.agent()];
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  await signIn(kepsek, k.email).expect(200);
  await signIn(guru, g.email).expect(200);
  const rows = await withTenant({ schoolId: school, userId: null }, (tx) =>
    tx
      .insert(schema.invoices)
      .values(
        (['2027-01', '2027-02', '2027-03'] as const).map((month) => ({
          schoolId: school,
          month,
          daysInMonth: 31,
          unitPrice: 10_000,
          exemptDays: 0,
          studentCount: 3,
          billedDays: 88,
          total: 28_387,
          dueOn: '2027-02-15',
        })),
      )
      .returning(),
  );
  [invoices.jan, invoices.feb, invoices.mar] = [rows[0]?.id ?? '', rows[1]?.id ?? '', rows[2]?.id ?? ''];
});

describe('POST /billing/invoices/{id}/payments', () => {
  it('stores the request and leaves the gateway to the worker; replays and repeats give the same payment', async () => {
    const key = uuidv7();
    const res = await pay(admin, invoices.jan, { method: 'va' }, key).expect(202);
    const payment = bodyOf<Payment>(res);
    expect(payment).toMatchObject({ status: 'requested', method: 'va', amount: 28_387, vaNumber: null });
    expect(t.paymentProvider.charges).toHaveLength(0);
    const replay = await pay(admin, invoices.jan, { method: 'va' }, key).expect(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    // A second click with a new key: the open VA is reused, not a second one.
    expect(bodyOf<Payment>(await pay(admin, invoices.jan, { method: 'va' }).expect(202)).id).toBe(payment.id);
  });

  it('checks role, body and invoice', async () => {
    await pay(kepsek, invoices.jan, { method: 'va' }).expect(403);
    await payments(guru, invoices.jan).expect(403);
    await pay(admin, invoices.jan, { method: 'cash' }).expect(400);
    await pay(admin, '0190a000-0000-7000-8000-000000000000', { method: 'va' }).expect(404);
  });

  it('answers 409 payments_unavailable without a gateway', async () => {
    const actor = { userId: adminId, schoolId: school, roles: ['admin' as const] };
    await expect(requestPayment(actor, { schoolId: school, actorUserId: adminId, requestId: null, ip: null }, null, invoices.jan, { method: 'va' })).rejects.toMatchObject({
      status: 409,
      details: { reason: 'payments_unavailable' },
    });
  });
});

describe('gateway', () => {
  let providerRef = '';

  it('the worker opens the VA once', async () => {
    await openCharges();
    expect(t.paymentProvider.charges).toHaveLength(1);
    const [p] = bodyOf<PaymentList>(await payments(kepsek, invoices.jan).expect(200)).items;
    expect(p).toMatchObject({ status: 'pending', vaBank: 'BNI' });
    expect(p?.vaNumber).toMatch(/^988\d{10}$/);
    // Redelivered event: no second charge.
    await openCharges();
    expect(t.paymentProvider.charges).toHaveLength(1);
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.payments).where(eq(schema.payments.invoiceId, invoices.jan)));
    providerRef = row?.providerRef ?? '';
  });

  it('refuses webhooks with a wrong signature', async () => {
    await webhook([{ providerRef, providerTxnId: txn('tx-1'), status: 'paid', amount: 28_387 }], 'wrong-secret-wrong-secret').expect(401);
  });

  it('records a payment once however often the webhook comes, and marks the invoice paid', async () => {
    const paid = [{ providerRef, providerTxnId: txn('tx-1'), status: 'paid' as const, amount: 28_387 }];
    await webhook(paid).expect(200);
    await webhook(paid).expect(200);
    expect(await applyPaymentWebhooks(t.paymentProvider)).toMatchObject({ applied: 1 });
    expect(await applyPaymentWebhooks(t.paymentProvider)).toMatchObject({ applied: 0 });
    // Same money announced again under another transaction id: still one payment.
    await webhook([{ providerRef, providerTxnId: txn('tx-1-resent'), status: 'paid', amount: 28_387 }]).expect(200);
    await applyPaymentWebhooks(t.paymentProvider);

    const rows = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.payments).where(eq(schema.payments.status, 'paid')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerTxnId: txn('tx-1'), paidAt: new Date('2027-02-03T02:00:00.000Z') });
    const [invoice] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoices.jan)));
    expect(invoice).toMatchObject({ status: 'paid', paidAt: new Date('2027-02-03T02:00:00.000Z') });
    const res = await pay(admin, invoices.jan, { method: 'qris' }).expect(409);
    expect((res.body as { details: { reason: string } }).details.reason).toBe('already_paid');
  });

  it('keeps the invoice open when less money arrives', async () => {
    await pay(admin, invoices.feb, { method: 'qris' }).expect(202);
    await openCharges();
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.payments).where(eq(schema.payments.invoiceId, invoices.feb)));
    expect(row?.qrString).toContain('FAKEQRIS');
    await webhook([{ providerRef: row?.providerRef ?? '', providerTxnId: txn('tx-2'), status: 'paid', amount: 10_000 }]).expect(200);
    await applyPaymentWebhooks(t.paymentProvider);
    const [after] = bodyOf<PaymentList>(await payments(admin, invoices.feb).expect(200)).items;
    expect(after).toMatchObject({ status: 'pending', error: 'underpaid:10000' });
  });

  it('marks a payment failed when the gateway refuses it on the last attempt', async () => {
    t.paymentProvider.failures.push(new PaymentError('http_400', false));
    await pay(admin, invoices.mar, { method: 'va' }).expect(202);
    await openCharges();
    const [p] = bodyOf<PaymentList>(await payments(admin, invoices.mar).expect(200)).items;
    expect(p).toMatchObject({ status: 'failed', error: 'http_400' });
  });

  it('lets events for unknown charges wait', async () => {
    await webhook([{ providerRef: 'fake-unknown', providerTxnId: txn('tx-9'), status: 'paid', amount: 1 }]).expect(200);
    expect((await applyPaymentWebhooks(t.paymentProvider)).waiting).toBeGreaterThanOrEqual(1);
  });
});
