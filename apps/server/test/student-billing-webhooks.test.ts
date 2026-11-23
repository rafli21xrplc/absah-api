import { schema } from '@absah/db';
import type { MyBillsList, StudentPayment } from '@absah/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyStudentPaymentWebhooks, studentBillingConsumers } from '../src/modules/student-billing';
import { applyPaymentWebhooks } from '../src/modules/subscription';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { FAKE_SIGNATURE_HEADER, signFakeWebhook } from '../src/shared/payments';
import { buildTestApp, signIn, type Agent } from './harness';
import { TEST_PAYMENT_SECRET } from './harness';

const t = buildTestApp();
afterAll(async () => {
  // The event for a charge that is nobody's is left unprocessed on purpose; do not leave it in the shared inbox.
  await getDb().db.execute(sql`update inbox_webhooks set processed_at = now() where processed_at is null and payload->>'providerTxnId' like ${`%${run}`}`);
  await t.cleanup();
});

let school: string;
let bendahara: Agent;
let parent: Agent;
const [consumer] = studentBillingConsumers(t.paymentProvider);
// inbox_webhooks is a platform table that outlives test schools: transaction ids unique per run.
const run = uuidv7();
const txn = (n: string) => `${n}-${run}`;
const key = () => `wh-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object = {}) => agent.post(`/api/v1/student-billing${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const mine = async () => (await parent.get('/api/v1/student-billing/mine').set('X-School-Id', school).expect(200)).body as MyBillsList;
const installment = async (period: string, number = 1) => (await mine()).items.find((b) => b.period === period)?.installments.find((i) => i.number === number);
const bill = async (period: string) => (await mine()).items.find((b) => b.period === period);

async function openCharges() {
  if (!consumer) throw new Error('no consumer');
  const events = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'student_payment.requested'))).orderBy(asc(schema.outboxEvents.createdAt));
  for (const e of events) await runConsumer(consumer, { id: e.id, schoolId: school, type: e.type, payload: e.payload, traceId: null, occurredAt: e.createdAt.toISOString() }, { attempt: 2, lastAttempt: true });
}

/** A payment asked for, its charge opened, and the gateway's reference for it. */
async function charge(installmentId: string, method: 'va' | 'qris' = 'va') {
  const requested = (await post(parent, `/installments/${installmentId}/payments`, { method }).expect(202)).body as StudentPayment;
  await openCharges();
  const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.studentPayments).where(eq(schema.studentPayments.id, requested.id)));
  return { id: requested.id, providerRef: row?.providerRef ?? '' };
}
const rowOf = async (id: string) => (await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.studentPayments).where(eq(schema.studentPayments.id, id))))[0];

/** What the fake gateway posts when money arrives (or the charge ends). */
function webhook(events: { providerRef: string; providerTxnId: string; status: 'paid' | 'expired' | 'failed'; amount: number }[], secret = TEST_PAYMENT_SECRET) {
  const raw = JSON.stringify({ events: events.map((e) => ({ ...e, at: '2027-02-03T02:00:00.000Z' })) });
  return request(t.app).post('/api/v1/webhooks/payments').set('Content-Type', 'application/json').set(FAKE_SIGNATURE_HEADER, signFakeWebhook(raw, secret)).send(raw);
}
const apply = () => applyStudentPaymentWebhooks(t.paymentProvider);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Webhook Siswa');
  const [b, p] = await Promise.all([t.staff('Bendahara Webhook'), t.staff('Ibu Webhook')]);
  await t.member(school, b.id, 'bendahara');
  await t.member(school, p.id, 'orang_tua');
  [bendahara, parent] = [t.agent(), t.agent()];
  await signIn(bendahara, b.email).expect(200);
  await signIn(parent, p.email).expect(200);
  const classId = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8A', grade: 8 }).returning();
    const [ani] = await tx.insert(schema.students).values({ schoolId: school, name: 'Ani Webhook' }).returning();
    await tx.insert(schema.enrollments).values({ schoolId: school, studentId: ani?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' });
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Ani', userId: p.id }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: ani?.id ?? '', guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
    return cls?.id ?? '';
  });
  const fee = (await post(bendahara, '/fee-types', { name: 'SPP', kind: 'spp', defaultAmount: 100_000 }).expect(201)).body as { id: string };
  const target = { kind: 'class', classId };
  const issue = (period: string, extra: object = {}) => post(bendahara, '/issue', { feeTypeId: fee.id, period, target, ...extra }).expect(201);
  await issue('Satu', { dueOn: '2999-01-10' });
  await issue('Cicilan', { amount: 200_000, installments: [{ amount: 120_000, dueOn: '2999-01-10' }, { amount: 80_000, dueOn: '2999-02-10' }] });
  for (const period of ['Kurang', 'Batal', 'Dua kali', 'Gagal']) await issue(period, { dueOn: '2999-01-10' });
});

describe('student payment webhooks (TGH-03)', () => {
  it('records a payment once however often the webhook comes, and marks the installment paid', async () => {
    const target = await installment('Satu');
    const { id, providerRef } = await charge(target?.id ?? '');
    await webhook([{ providerRef, providerTxnId: txn('tx-1'), status: 'paid', amount: 100_000 }], 'wrong-secret-wrong-secret').expect(401);
    expect(await apply()).toEqual({ applied: 0 });
    await webhook([{ providerRef, providerTxnId: txn('tx-1'), status: 'paid', amount: 100_000 }]).expect(200);
    await webhook([{ providerRef, providerTxnId: txn('tx-1'), status: 'paid', amount: 100_000 }]).expect(200); // the gateway sends it again
    expect(await apply()).toEqual({ applied: 1 });
    expect(await apply()).toEqual({ applied: 0 });
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: 'paid', providerTxnId: txn('tx-1'), lastError: null });
    expect(row?.paidAt?.toISOString()).toBe('2027-02-03T02:00:00.000Z');
    const paid = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.studentPayments).where(and(eq(schema.studentPayments.installmentId, target?.id ?? ''), eq(schema.studentPayments.status, 'paid'))));
    expect(paid).toHaveLength(1);
    expect(await bill('Satu')).toMatchObject({ status: 'paid', paid: 100_000, overdue: false, paidAt: '2027-02-03T02:00:00.000Z' });
    expect((await installment('Satu'))?.payment).toMatchObject({ status: 'paid' });
    // A second webhook with another transaction id for the same, already paid, charge changes nothing either.
    await webhook([{ providerRef, providerTxnId: txn('tx-1b'), status: 'paid', amount: 100_000 }]);
    await apply();
    expect((await rowOf(id))?.providerTxnId).toBe(txn('tx-1'));
  });

  it('leaves the bill open until the last installment is paid', async () => {
    const first = await installment('Cicilan', 1);
    const a = await charge(first?.id ?? '');
    await webhook([{ providerRef: a.providerRef, providerTxnId: txn('tx-2a'), status: 'paid', amount: 120_000 }]);
    await apply();
    expect(await bill('Cicilan')).toMatchObject({ status: 'open', paid: 120_000, paidAt: null });
    const second = await installment('Cicilan', 2);
    const b = await charge(second?.id ?? '', 'qris');
    await webhook([{ providerRef: b.providerRef, providerTxnId: txn('tx-2b'), status: 'paid', amount: 80_000 }]);
    await apply();
    expect(await bill('Cicilan')).toMatchObject({ status: 'paid', paid: 200_000 });
  });

  it('keeps an installment open when less than its amount arrived', async () => {
    const target = await installment('Kurang');
    const { id, providerRef } = await charge(target?.id ?? '');
    await webhook([{ providerRef, providerTxnId: txn('tx-3'), status: 'paid', amount: 99_999 }]);
    await apply();
    expect(await rowOf(id)).toMatchObject({ status: 'pending', lastError: 'underpaid:99999' });
    expect((await installment('Kurang'))?.paidAt).toBeNull();
    expect(await bill('Kurang')).toMatchObject({ status: 'open', paid: 0 });
  });

  it('records the money but counts nothing when the installment was paid twice or the bill was voided meanwhile', async () => {
    const twice = await installment('Dua kali');
    const va = await charge(twice?.id ?? '', 'va');
    const qris = await charge(twice?.id ?? '', 'qris');
    await webhook([{ providerRef: va.providerRef, providerTxnId: txn('tx-4a'), status: 'paid', amount: 100_000 }, { providerRef: qris.providerRef, providerTxnId: txn('tx-4b'), status: 'paid', amount: 100_000 }]);
    await apply();
    expect(await rowOf(va.id)).toMatchObject({ status: 'paid', lastError: null });
    expect(await rowOf(qris.id)).toMatchObject({ status: 'paid', lastError: 'paid_twice' });
    expect(await bill('Dua kali')).toMatchObject({ status: 'paid', paid: 100_000 });

    const voidable = (await bendahara.get('/api/v1/student-billing/bills?period=Batal').set('X-School-Id', school).expect(200)).body as { items: { id: string; installments: { id: string }[] }[] };
    const pending = await charge(voidable.items[0]?.installments[0]?.id ?? '');
    await post(bendahara, `/bills/${voidable.items[0]?.id}/void`, { reason: 'Salah terbit' }).expect(200);
    await webhook([{ providerRef: pending.providerRef, providerTxnId: txn('tx-5'), status: 'paid', amount: 100_000 }]);
    await apply();
    expect(await rowOf(pending.id)).toMatchObject({ status: 'paid', lastError: 'bill_void' });
    const [inst] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.billInstallments).where(eq(schema.billInstallments.id, voidable.items[0]?.installments[0]?.id ?? '')));
    expect(inst?.paidAt).toBeNull();
  });

  it('marks a charge that expired or failed, and lets the parent ask again', async () => {
    const target = await installment('Gagal');
    const a = await charge(target?.id ?? '');
    await webhook([{ providerRef: a.providerRef, providerTxnId: txn('tx-6'), status: 'expired', amount: 0 }]);
    await apply();
    expect(await rowOf(a.id)).toMatchObject({ status: 'expired' });
    const b = await charge(target?.id ?? '');
    expect(b.id).not.toBe(a.id);
    await webhook([{ providerRef: b.providerRef, providerTxnId: txn('tx-7'), status: 'failed', amount: 0 }]);
    await apply();
    expect(await rowOf(b.id)).toMatchObject({ status: 'failed', lastError: 'gateway_failed' });
    expect((await installment('Gagal'))?.paidAt).toBeNull();
  });

  it('leaves an event that is not for a student payment to the other job, and the subscription job leaves ours', async () => {
    const target = await installment('Gagal');
    const c = await charge(target?.id ?? '');
    await webhook([{ providerRef: 'fake-somebody-elses', providerTxnId: txn('tx-8'), status: 'paid', amount: 1 }, { providerRef: c.providerRef, providerTxnId: txn('tx-9'), status: 'paid', amount: 100_000 }]);
    expect(await applyPaymentWebhooks(t.paymentProvider)).toMatchObject({ applied: 0 }); // the subscription job finds neither of them its own
    expect(await rowOf(c.id)).toMatchObject({ status: 'pending' });
    expect(await apply()).toEqual({ applied: 1 });
    expect(await rowOf(c.id)).toMatchObject({ status: 'paid' });
  });
});
