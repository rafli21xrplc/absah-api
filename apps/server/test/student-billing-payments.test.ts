import { schema } from '@absah/db';
import type { MyBillsList, StudentPayment } from '@absah/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestStudentPayment, studentBillingConsumers } from '../src/modules/student-billing';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { PaymentError } from '../src/shared/payments';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let spp: string;
let class8a: string;
const ids: Record<string, string> = {};
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const [consumer] = studentBillingConsumers(t.paymentProvider);
const key = () => `pay-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object = {}, k = key(), schoolId = school) => agent.post(`/api/v1/student-billing${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const mine = async (agent: Agent) => (await agent.get('/api/v1/student-billing/mine').set('X-School-Id', school).expect(200)).body as MyBillsList;
const pay = (agent: Agent, installmentId: string, body: object = { method: 'va' }, k = key()) => post(agent, `/installments/${installmentId}/payments`, body, k);
const installmentOf = (list: MyBillsList, period: string, number = 1) => list.items.find((b) => b.period === period)?.installments.find((i) => i.number === number);

/** Runs the worker's consumer on every student_payment.requested event of the school not handled yet. */
async function openCharges(attempt = 2) {
  if (!consumer) throw new Error('no consumer');
  const events = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'student_payment.requested'))).orderBy(asc(schema.outboxEvents.createdAt));
  const results = [];
  for (const e of events) results.push(await runConsumer(consumer, { id: e.id, schoolId: school, type: e.type, payload: e.payload, traceId: null, occurredAt: e.createdAt.toISOString() }, { attempt, lastAttempt: attempt >= 2 }));
  return results;
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Bayar Siswa');
  other = await t.school('smp', 'SMP Bayar Lain');
  const students = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8A', grade: 8 }).returning();
    class8a = cls?.id ?? '';
    const rows = await tx.insert(schema.students).values([{ schoolId: school, name: 'Ani Bayar' }, { schoolId: school, name: 'Budi Bayar' }]).returning();
    await tx.insert(schema.enrollments).values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: class8a, academicYearId: year?.id ?? '', startsOn: '2026-07-13' })));
    return rows;
  });
  const people = { bendahara: 'bendahara', admin: 'admin', guru: 'guru', ibuAni: 'orang_tua', ibuBudi: 'orang_tua', ani: 'siswa' } as const;
  for (const [name, role] of Object.entries(people)) {
    const p = await t.staff(`Bayar ${name}`);
    ids[name] = p.id;
    await t.member(school, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  const [ani, budi] = students;
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    await tx.update(schema.students).set({ userId: ids['ani'] ?? null }).where(eq(schema.students.id, ani?.id ?? ''));
    for (const [student, userId] of [[ani, ids['ibuAni']], [budi, ids['ibuBudi']]] as const) {
      const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: `Wali ${student?.name}`, userId: userId ?? null }).returning();
      await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: student?.id ?? '', guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
    }
  });
  const fee = await post(A('bendahara'), '/fee-types', { name: 'SPP', kind: 'spp', defaultAmount: 250_000 }).expect(201);
  spp = (fee.body as { id: string }).id;
  const target = { kind: 'class', classId: class8a };
  await post(A('bendahara'), '/issue', { feeTypeId: spp, period: '2026-11', dueOn: '2999-01-10', target }).expect(201);
  await post(A('bendahara'), '/issue', { feeTypeId: spp, period: 'Cicilan', amount: 200_000, installments: [{ amount: 120_000, dueOn: '2999-01-10' }, { amount: 80_000, dueOn: '2999-02-10' }], target }).expect(201);
  await post(A('bendahara'), '/issue', { feeTypeId: spp, period: 'Salah', dueOn: '2999-01-10', target }).expect(201);
  const wrong = (await A('bendahara').get('/api/v1/student-billing/bills?period=Salah').set('X-School-Id', school).expect(200)).body as { items: { id: string }[] };
  for (const b of wrong.items) await post(A('bendahara'), `/bills/${b.id}/void`, { reason: 'Salah terbit' }).expect(200);
});

describe('GET /student-billing/mine (TGH-03)', () => {
  it('shows a parent only the bills of their own child, and leaves out the void ones', async () => {
    const mineAni = await mine(A('ibuAni'));
    expect(mineAni.items.map((b) => [b.student.name, b.period]).sort()).toEqual([['Ani Bayar', '2026-11'], ['Ani Bayar', 'Cicilan']]);
    const mineBudi = await mine(A('ibuBudi'));
    expect(mineBudi.items.every((b) => b.student.name === 'Budi Bayar')).toBe(true);
    expect(mineBudi.items).toHaveLength(2);
    expect(installmentOf(mineAni, 'Cicilan', 2)).toMatchObject({ amount: 80_000, paidAt: null, payment: null });
  });

  it('shows a student their own, and is closed to staff and to other schools', async () => {
    expect((await mine(A('ani'))).items.every((b) => b.student.name === 'Ani Bayar')).toBe(true);
    for (const name of ['bendahara', 'admin', 'guru']) await A(name).get('/api/v1/student-billing/mine').set('X-School-Id', school).expect(403);
    await A('ibuAni').get('/api/v1/student-billing/mine').set('X-School-Id', other).expect(403);
    await t.agent().get('/api/v1/student-billing/mine').set('X-School-Id', school).expect(401);
  });
});

describe('POST /student-billing/installments/{id}/payments (TGH-03)', () => {
  let first: StudentPayment;

  it('stores the request and leaves the gateway to the worker; replays and repeats give the same payment', async () => {
    const target = installmentOf(await mine(A('ibuAni')), '2026-11');
    const k = key();
    const res = await pay(A('ibuAni'), target?.id ?? '', { method: 'va' }, k).expect(202);
    first = res.body as StudentPayment;
    expect(first).toMatchObject({ status: 'requested', method: 'va', amount: 250_000, vaNumber: null, installmentId: target?.id });
    expect(t.paymentProvider.charges).toHaveLength(0);
    expect((await pay(A('ibuAni'), target?.id ?? '', { method: 'va' }, k).expect(202)).headers['idempotent-replayed']).toBe('true');
    expect(((await pay(A('ibuAni'), target?.id ?? '', { method: 'va' }).expect(202)).body as StudentPayment).id).toBe(first.id); // a second tap is the same VA
    expect(((await pay(A('ibuAni'), target?.id ?? '', { method: 'qris' }).expect(202)).body as StudentPayment).id).not.toBe(first.id);
  });

  it('lets the student pay their own installment too', async () => {
    const target = installmentOf(await mine(A('ani')), 'Cicilan', 1);
    expect(((await pay(A('ani'), target?.id ?? '').expect(202)).body as StudentPayment).amount).toBe(120_000);
  });

  it('opens each charge once in the worker, with the installment’s amount, and shows it to the parent', async () => {
    await openCharges();
    expect(t.paymentProvider.charges).toHaveLength(3);
    expect(t.paymentProvider.charges.map((c) => c.amount).sort()).toEqual([120_000, 250_000, 250_000]);
    expect(t.paymentProvider.charges.find((c) => c.amount === 120_000)?.description).toBe('SPP Cicilan (cicilan 1)');
    const shown = installmentOf(await mine(A('ibuAni')), '2026-11');
    expect(shown?.payment).toMatchObject({ status: 'pending', method: 'qris' }); // the latest attempt
    await openCharges(); // redelivered events: no second charge
    expect(t.paymentProvider.charges).toHaveLength(3);
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.studentPayments).where(eq(schema.studentPayments.id, first.id)));
    expect(row).toMatchObject({ status: 'pending', provider: 'fake', vaBank: 'BNI' });
    expect(row?.vaNumber).toMatch(/^988\d{10}$/);
  });

  it('refuses what is not the caller’s to pay', async () => {
    const budi = installmentOf(await mine(A('ibuBudi')), '2026-11');
    await pay(A('ibuAni'), budi?.id ?? '').expect(404); // someone else's child
    await pay(A('ani'), budi?.id ?? '').expect(404);
    await pay(A('ibuAni'), uuidv7()).expect(404);
    for (const name of ['bendahara', 'admin', 'guru']) await pay(A(name), budi?.id ?? '').expect(403);
    await pay(A('ibuBudi'), budi?.id ?? '', { method: 'cash' }).expect(400);
    await pay(A('ibuBudi'), 'not-a-uuid').expect(400);
  });

  it('refuses an installment that is paid, or whose bill was voided', async () => {
    const budi = installmentOf(await mine(A('ibuBudi')), 'Cicilan', 1);
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.billInstallments).set({ paidAt: new Date() }).where(eq(schema.billInstallments.id, budi?.id ?? '')));
    expect((await pay(A('ibuBudi'), budi?.id ?? '').expect(409)).body).toMatchObject({ details: { reason: 'already_paid' } });
    const [voided] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select({ id: schema.billInstallments.id }).from(schema.billInstallments).innerJoin(schema.studentBills, eq(schema.studentBills.id, schema.billInstallments.billId)).innerJoin(schema.enrollments, eq(schema.enrollments.id, schema.studentBills.enrollmentId)).innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId)).where(and(eq(schema.studentBills.period, 'Salah'), eq(schema.students.name, 'Budi Bayar'))));
    expect((await pay(A('ibuBudi'), voided?.id ?? '').expect(409)).body).toMatchObject({ details: { reason: 'bill_void' } }); // a void bill is not even listed, but its id must not work either
  });

  it('answers 409 payments_unavailable without a gateway', async () => {
    const target = installmentOf(await mine(A('ibuBudi')), '2026-11');
    const actor = { userId: ids['ibuBudi'] ?? '', schoolId: school, roles: ['orang_tua' as const] };
    await expect(requestStudentPayment(actor, { schoolId: school, actorUserId: actor.userId, requestId: null, ip: null }, null, target?.id ?? '', { method: 'va' })).rejects.toMatchObject({ status: 409, details: { reason: 'payments_unavailable' } });
  });

  it('marks a payment failed when the gateway refuses it, and lets the parent ask again', async () => {
    const target = installmentOf(await mine(A('ibuBudi')), '2026-11');
    const requested = (await pay(A('ibuBudi'), target?.id ?? '').expect(202)).body as StudentPayment;
    t.paymentProvider.failures.push(new PaymentError('invalid_account', false));
    await openCharges();
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.studentPayments).where(eq(schema.studentPayments.id, requested.id)));
    expect(row).toMatchObject({ status: 'failed', lastError: 'invalid_account' });
    expect(installmentOf(await mine(A('ibuBudi')), '2026-11')?.payment).toMatchObject({ status: 'failed', error: 'invalid_account' });
    const again = (await pay(A('ibuBudi'), target?.id ?? '').expect(202)).body as StudentPayment;
    expect(again.id).not.toBe(requested.id);
  });

  it('reads a charge past its expiry as expired and opens a new one on request', async () => {
    const target = installmentOf(await mine(A('ibuAni')), '2026-11');
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.studentPayments).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.studentPayments.installmentId, target?.id ?? '')));
    expect(installmentOf(await mine(A('ibuAni')), '2026-11')?.payment?.status).toBe('expired');
    const renewed = (await pay(A('ibuAni'), target?.id ?? '', { method: 'va' }).expect(202)).body as StudentPayment;
    expect(renewed.id).not.toBe(first.id);
    expect(renewed.status).toBe('requested');
  });

  it('writes who asked and how much to the audit log', async () => {
    const logs = await getDb().db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'billing.student_payment_requested')));
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs.some((l) => l.actorUserId === ids['ibuAni'] && (l.after as { amount: number }).amount === 250_000)).toBe(true);
  });
});
