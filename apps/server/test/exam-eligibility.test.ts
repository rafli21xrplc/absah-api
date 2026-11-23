import { schema } from '@absah/db';
import type { EligibilityList, MyBillsList, StudentPayment } from '@absah/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyStudentPaymentWebhooks, studentBillingConsumers } from '../src/modules/student-billing';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { FAKE_SIGNATURE_HEADER, signFakeWebhook } from '../src/shared/payments';
import { buildTestApp, enableTotp, signIn, TEST_PAYMENT_SECRET, type Agent } from './harness';

const t = buildTestApp();
// inbox_webhooks is a platform table that outlives test schools: transaction ids unique per run, rows closed at the end.
const run = uuidv7();
afterAll(async () => {
  await getDb().db.execute(sql`update inbox_webhooks set processed_at = now() where processed_at is null and payload->>'providerTxnId' like ${`%${run}`}`);
  await t.cleanup();
});

let school: string;
let off: string;
let classA: string;
let classB: string;
let periodId: string;
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const [consumer] = studentBillingConsumers(t.paymentProvider);
const key = () => `ujn-${uuidv7()}`;
const eligibility = (agent: Agent, query = '', id = periodId, schoolId = school) => agent.get(`/api/v1/exam/periods/${id}/eligibility${query}`).set('X-School-Id', schoolId);
const body = async (agent: Agent, query = '') => (await eligibility(agent, query).expect(200)).body as EligibilityList;
const names = (list: EligibilityList) => list.items.map((i) => i.student.name);
const patchPeriod = (fields: object) => A('wakasek').patch(`/api/v1/exam/periods/${periodId}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(fields).expect(200);

/** Days with a record, `n` of them from `start` on, all with one status. */
const days = (enrollmentId: string, status: 'H' | 'S' | 'I' | 'A' | 'T', start: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ schoolId: school, enrollmentId, schoolDate: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), status }));

beforeAll(async () => {
  school = await t.school('smp', 'SMP Boleh Ujian');
  off = await t.school('smp', 'SMP Ujian Mati Dua');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'exam.enabled', value: false });
  const people = { wakasek: 'wakasek', kepsek: 'kepsek', admin: 'admin', wali1: 'wali_kelas', wali2: 'wali_kelas', guru: 'guru', bendahara: 'bendahara', ortu: 'orang_tua' } as const;
  const ids: Record<string, string> = {};
  for (const [name, role] of Object.entries(people)) {
    const p = await t.staff(`Boleh ${name}`);
    ids[name] = p.id;
    for (const s of [school, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  const feeId = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [a, b] = await tx.insert(schema.classes).values([{ schoolId: school, academicYearId: yearId, name: '8A', grade: 8, homeroomTeacherId: ids.wali1 }, { schoolId: school, academicYearId: yearId, name: '8B', grade: 8, homeroomTeacherId: ids.wali2 }]).returning();
    classA = a?.id ?? '';
    classB = b?.id ?? '';
    const enroll: Record<string, string> = {};
    for (const [name, cls] of [['Ani', classA], ['Budi', classA], ['Citra', classA], ['Eko', classA], ['Dedi', classB]] as const) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      enroll[name] = (await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls, academicYearId: yearId, startsOn: '2026-07-13' }).returning())[0]?.id ?? '';
      if (name === 'Citra') {
        const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Citra', userId: ids.ortu }).returning();
        await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: s?.id ?? '', guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
      }
    }
    const e = (name: string) => enroll[name] ?? '';
    await tx.insert(schema.dailyAttendance).values([
      ...days(e('Ani'), 'H', '2026-09-01', 10), // 100%
      ...days(e('Budi'), 'A', '2026-08-03', 4), // absent in August...
      ...days(e('Budi'), 'H', '2026-09-01', 6), // ...present in September: 60% from the year's start, 100% from 1 September
      ...days(e('Citra'), 'H', '2026-09-01', 10),
      ...days(e('Eko'), 'H', '2026-09-01', 6), // 6 hadir and 4 sakit: 100% when sakit counts, 60% when not
      ...days(e('Eko'), 'S', '2026-09-20', 4),
      ...days(e('Dedi'), 'A', '2026-09-01', 10), // 0%
    ]);
    const [fee] = await tx.insert(schema.feeTypes).values({ schoolId: school, name: 'SPP', kind: 'spp', defaultAmount: 100_000 }).returning();
    return fee?.id ?? '';
  });
  // The wakasek's period: 75% attendance and bills paid (those due by the first exam day).
  const made = await A('wakasek').post('/api/v1/exam/periods').set('X-School-Id', school).set('Idempotency-Key', key()).send({ name: 'PTS Ganjil', startsOn: '2026-12-01', endsOn: '2026-12-05', minAttendance: 75, requirePaid: true, feeTypeIds: [feeId] }).expect(201);
  periodId = (made.body as { id: string }).id;
  // Citra and Dedi were billed SPP due in November; the others have nothing owing.
  for (const [cls, period] of [[classA, 'Nov A'], [classB, 'Nov B']] as const) {
    const issue = await A('bendahara').post('/api/v1/student-billing/issue').set('X-School-Id', school).set('Idempotency-Key', key()).send({ feeTypeId: feeId, period, target: { kind: 'class', classId: cls }, dueOn: '2026-11-10' });
    expect(issue.status).toBe(201);
  }
  // Only Citra's and Dedi's bills should matter: void Ani's, Budi's and Eko's (a bill voided is not owed).
  const bills = await getDb().db.execute<{ id: string }>(sql`select b.id from student_bills b join enrollments e on e.id = b.enrollment_id join students s on s.id = e.student_id where s.name in ('Ani','Budi','Eko') and b.school_id = ${school}`);
  for (const b of bills.rows) await A('bendahara').post(`/api/v1/student-billing/bills/${b.id}/void`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ reason: 'Bebas biaya' }).expect(200);
});

/** The gateway's confirmation, through the real request, webhook and apply path. */
async function pay(installmentId: string) {
  if (!consumer) throw new Error('no consumer');
  const requested = (await A('ortu').post(`/api/v1/student-billing/installments/${installmentId}/payments`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ method: 'va' }).expect(202)).body as StudentPayment;
  const events = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'student_payment.requested'))).orderBy(asc(schema.outboxEvents.createdAt));
  for (const ev of events) await runConsumer(consumer, { id: ev.id, schoolId: school, type: ev.type, payload: ev.payload, traceId: null, occurredAt: ev.createdAt.toISOString() }, { attempt: 2, lastAttempt: true });
  const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.studentPayments).where(eq(schema.studentPayments.id, requested.id)));
  const raw = JSON.stringify({ events: [{ providerRef: row?.providerRef ?? '', providerTxnId: `tx-${requested.id}-${run}`, status: 'paid', amount: row?.amount ?? 0, at: '2026-11-20T02:00:00.000Z' }] });
  await request(t.app).post('/api/v1/webhooks/payments').set('Content-Type', 'application/json').set(FAKE_SIGNATURE_HEADER, signFakeWebhook(raw, TEST_PAYMENT_SECRET)).send(raw).expect(200);
  await applyStudentPaymentWebhooks(t.paymentProvider);
}

describe('who may sit an exam (UJN-02)', () => {
  it('lists the students who may not, with the school’s rule and the student’s own number as the reason', async () => {
    const list = await body(A('wakasek'));
    expect(list.period.name).toBe('PTS Ganjil');
    expect(list.counts).toEqual({ students: 5, eligible: 2, ineligible: 3 }); // Ani and Eko sit
    expect(list.items.map((i) => [i.student.name, i.className, i.eligible, i.reasons.map((r) => r.kind)])).toEqual([
      ['Budi', '8A', false, ['attendance']],
      ['Citra', '8A', false, ['bills']],
      ['Dedi', '8B', false, ['attendance', 'bills']],
    ]);
    expect(list.items[0]?.reasons[0]).toEqual({ kind: 'attendance', percent: 60, minimum: 75 });
    expect(list.items[1]?.reasons[0]).toEqual({ kind: 'bills', unpaidInstallments: 1 });
    expect(list.items[2]?.reasons[0]).toEqual({ kind: 'attendance', percent: 0, minimum: 75 });
    expect(JSON.stringify(list)).not.toMatch(/amount|100000/); // the wali kelas sees that something is owed, never how much
  });

  it('lists everyone with show=all, in rombel and name order', async () => {
    const list = await body(A('kepsek'), '?show=all');
    expect(list.items.map((i) => [i.className, i.student.name, i.eligible])).toEqual([['8A', 'Ani', true], ['8A', 'Budi', false], ['8A', 'Citra', false], ['8A', 'Eko', true], ['8B', 'Dedi', false]]);
  });

  it('shows a wali kelas only their own rombel, and does not admit a rombel that is not theirs', async () => {
    expect(names(await body(A('wali1')))).toEqual(['Budi', 'Citra']);
    expect(names(await body(A('wali2')))).toEqual(['Dedi']);
    expect((await body(A('wali1'), '?show=all')).counts.students).toBe(4);
    expect(names(await body(A('wali1'), `?classId=${classA}`))).toEqual(['Budi', 'Citra']);
    await eligibility(A('wali1'), `?classId=${classB}`).expect(404);
    expect(names(await body(A('wakasek'), `?classId=${classB}`))).toEqual(['Dedi']);
  });

  it('changes when a bill is paid: the student leaves the list as soon as the installment is paid', async () => {
    const mine = (await A('ortu').get('/api/v1/student-billing/mine').set('X-School-Id', school).expect(200)).body as MyBillsList;
    const installment = mine.items[0]?.installments[0];
    expect(installment?.paidAt ?? null).toBeNull();
    await pay(installment?.id ?? '');
    const after = await body(A('wakasek'));
    expect(names(after)).toEqual(['Budi', 'Dedi']);
    expect(after.counts).toEqual({ students: 5, eligible: 3, ineligible: 2 });
    expect(names(await body(A('wali1')))).toEqual(['Budi']);
  });

  it('follows the rule when it is edited: counting attendance from a later day, and sakit not counting as present', async () => {
    await patchPeriod({ attendanceFrom: '2026-09-01' }); // Budi's August absences no longer count
    expect(names(await body(A('wakasek')))).toEqual(['Dedi']);
    await patchPeriod({ excusedCounts: false }); // Eko's 4 sakit now count against him: 60%
    const list = await body(A('wakasek'));
    expect(names(list)).toEqual(['Eko', 'Dedi']);
    expect(list.items[0]?.reasons).toEqual([{ kind: 'attendance', percent: 60, minimum: 75 }]);
    await patchPeriod({ minAttendance: null, requirePaid: false, feeTypeIds: [] }); // no rule at all: everyone sits
    expect((await body(A('wakasek'))).counts).toEqual({ students: 5, eligible: 5, ineligible: 0 });
    await patchPeriod({ minAttendance: 75, requirePaid: true });
    expect(names(await body(A('wakasek')))).toEqual(['Eko', 'Dedi']); // Dedi still owes; the fee type list was cleared, so every fee type counts
  });

  it('is for wakasek, kepsek, admin and the wali kelas, behind the capability, inside the school', async () => {
    for (const name of ['wakasek', 'kepsek', 'admin', 'wali1']) await eligibility(A(name)).expect(200);
    for (const name of ['guru', 'bendahara', 'ortu']) await eligibility(A(name)).expect(403);
    await eligibility(A('wakasek'), '', periodId, off).expect(404);
    await eligibility(A('wakasek'), '', uuidv7()).expect(404);
    await eligibility(A('wakasek'), '?show=nobody').expect(400);
    await request(t.app).get(`/api/v1/exam/periods/${periodId}/eligibility`).set('X-School-Id', school).expect(401);
  });
});
