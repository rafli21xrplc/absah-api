import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let enrollmentId: string;
let feeTypeId: string;
let billId: string;
let installmentId: string;
let paymentId: string;

/** The Postgres message behind a failed query (Drizzle wraps it), or null when the query went through. */
const refusal = async (query: Promise<unknown>): Promise<string | null> => {
  try {
    await query;
    return null;
  } catch (err) {
    return (err as { cause?: { message?: string } }).cause?.message ?? String(err);
  }
};
const inSchool = <T>(schoolId: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ schoolId, userId: null }, fn);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Tagihan Skema');
  other = await t.school('smp', 'SMP Tagihan Lain');
  await inSchool(school, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8A', grade: 8 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'Siswa Tagihan' }).returning();
    const [enrollment] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
    enrollmentId = enrollment?.id ?? '';
    const [fee] = await tx.insert(schema.feeTypes).values({ schoolId: school, name: 'SPP', kind: 'spp', defaultAmount: 250_000 }).returning();
    feeTypeId = fee?.id ?? '';
    const [bill] = await tx.insert(schema.studentBills).values({ schoolId: school, enrollmentId, feeTypeId, period: '2026-11', title: 'SPP November 2026', total: 250_000, dueOn: '2026-11-10' }).returning();
    billId = bill?.id ?? '';
    const [installment] = await tx.insert(schema.billInstallments).values({ schoolId: school, billId, number: 1, amount: 250_000, dueOn: '2026-11-10' }).returning();
    installmentId = installment?.id ?? '';
    const [payment] = await tx.insert(schema.studentPayments).values({ schoolId: school, installmentId, provider: 'fake', method: 'va', amount: 250_000 }).returning();
    paymentId = payment?.id ?? '';
  });
});

describe('student billing tables (TGH)', () => {
  it('are visible to their own school and to no other', async () => {
    const own = await inSchool(school, async (tx) => ({
      fees: await tx.select().from(schema.feeTypes),
      bills: await tx.select().from(schema.studentBills),
      installments: await tx.select().from(schema.billInstallments),
      payments: await tx.select().from(schema.studentPayments),
    }));
    expect(own.fees).toHaveLength(1);
    expect(own.bills).toHaveLength(1);
    expect(own.installments).toHaveLength(1);
    expect(own.payments).toHaveLength(1);
    const foreign = await inSchool(other, async (tx) => (await tx.select().from(schema.studentBills)).length + (await tx.select().from(schema.studentPayments)).length + (await tx.select().from(schema.feeTypes)).length);
    expect(foreign).toBe(0);
  });

  it('refuse a row written for another school', async () => {
    expect(await refusal(inSchool(other, (tx) => tx.insert(schema.feeTypes).values({ schoolId: school, name: 'Intruder', kind: 'lainnya', defaultAmount: 1 })))).toMatch(/row-level security/);
  });

  it('are never deleted by the app role', async () => {
    for (const table of ['fee_types', 'student_bills', 'bill_installments', 'student_payments']) {
      expect(await refusal(inSchool(school, (tx) => tx.execute(sql.raw(`delete from ${table}`)))), table).toMatch(/permission denied/);
    }
  });

  it('let only the columns of their life change', async () => {
    // Allowed: a fee is repriced, an installment paid, a payment gets its charge, a bill is paid.
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.feeTypes).set({ defaultAmount: 260_000 }).where(eq(schema.feeTypes.id, feeTypeId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentPayments).set({ status: 'pending', providerRef: 'ref-1', vaNumber: '8801' }).where(eq(schema.studentPayments.id, paymentId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.billInstallments).set({ paidAt: new Date() }).where(eq(schema.billInstallments.id, installmentId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentBills).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.studentBills.id, billId))))).toBeNull();
    // Refused: what a bill, an installment and a payment are worth, and whose they are.
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentBills).set({ total: 1 }).where(eq(schema.studentBills.id, billId))))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.billInstallments).set({ amount: 1 }).where(eq(schema.billInstallments.id, installmentId))))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentPayments).set({ amount: 1 }).where(eq(schema.studentPayments.id, paymentId))))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentBills).set({ enrollmentId: crypto.randomUUID() }).where(eq(schema.studentBills.id, billId))))).toMatch(/permission denied/);
  });

  it('keep one bill per student, fee type and period, and fee type names unique ignoring case', async () => {
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.studentBills).values({ schoolId: school, enrollmentId, feeTypeId, period: '2026-11', title: 'Lagi', total: 1, dueOn: '2026-11-10' })))).toMatch(/student_bills_enrollment_fee_period_key/);
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.feeTypes).values({ schoolId: school, name: 'spp', kind: 'spp', defaultAmount: 1 })))).toMatch(/fee_types_school_id_name_key/);
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.billInstallments).values({ schoolId: school, billId, number: 1, amount: 1, dueOn: '2026-11-10' })))).toMatch(/bill_installments_bill_id_number_key/);
  });

  it('refuse a bill of nothing, and a void bill without its time', async () => {
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.studentBills).values({ schoolId: school, enrollmentId, feeTypeId, period: '2026-12', title: 'Nol', total: 0, dueOn: '2026-12-10' })))).toMatch(/student_bills_total_check/);
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.studentBills).values({ schoolId: school, enrollmentId, feeTypeId, period: '2026-12', title: 'Batal', total: 5, dueOn: '2026-12-10', status: 'void' })))).toMatch(/student_bills_void_check/);
  });

  it('record one payment per gateway transaction, however it arrives', async () => {
    const second = await inSchool(school, async (tx) => {
      const [p] = await tx.insert(schema.studentPayments).values({ schoolId: school, installmentId, provider: 'fake', method: 'qris', amount: 250_000 }).returning();
      return p?.id ?? '';
    });
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentPayments).set({ providerTxnId: 'txn-1', status: 'paid' }).where(eq(schema.studentPayments.id, paymentId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.studentPayments).set({ providerTxnId: 'txn-1', status: 'paid' }).where(eq(schema.studentPayments.id, second))))).toMatch(/student_payments_provider_txn_id_key/);
  });

  it('accept the bendahara role in a school', async () => {
    const person = await t.staff('Bu Bendahara Skema');
    await t.member(school, person.id, 'bendahara');
    const roles = await inSchool(school, (tx) => tx.select({ role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.userId, person.id)));
    expect(roles.map((r) => r.role)).toEqual(['bendahara']);
  });
});
