import { schema, type Tx } from '@absah/db';
import type { BillStatus, BillTarget, BillsQuery } from '@absah/contracts';
import { and, asc, count, desc, eq, exists, inArray, lt, isNull, sql } from 'drizzle-orm';

const b = schema.studentBills;
const i = schema.billInstallments;
const e = schema.enrollments;

/** Active students of a rombel or a grade in the school's active academic year: who a mass issue bills. */
export async function activeEnrollmentsOf(tx: Tx, target: BillTarget): Promise<string[]> {
  const base = tx
    .select({ id: e.id })
    .from(e)
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)));
  const rows = await base.where(and(eq(e.status, 'active'), target.kind === 'class' ? eq(e.classId, target.classId) : eq(schema.classes.grade, target.grade)));
  return rows.map((r) => r.id);
}

export async function classExists(tx: Tx, classId: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId));
  return Boolean(row);
}

/** Inserts the bills that do not exist yet (same student, fee type and period) and returns the ones that are new. */
export async function insertNewBills(
  tx: Tx,
  rows: { id: string; schoolId: string; enrollmentId: string; feeTypeId: string; period: string; title: string; total: number; dueOn: string; issuedBy: string }[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const inserted = await tx.insert(b).values(rows).onConflictDoNothing({ target: [b.schoolId, b.enrollmentId, b.feeTypeId, b.period] }).returning({ id: b.id });
  return inserted.map((r) => r.id);
}

export function insertInstallments(tx: Tx, rows: { schoolId: string; billId: string; number: number; amount: number; dueOn: string }[]) {
  return rows.length === 0 ? Promise.resolve() : tx.insert(i).values(rows);
}

export type InstallmentRow = { id: string; billId: string; number: number; amount: number; dueOn: string; paidAt: Date | null };
export type BillRow = {
  id: string;
  enrollmentId: string;
  studentName: string;
  className: string;
  feeTypeId: string;
  feeTypeName: string;
  period: string;
  title: string;
  total: number;
  dueOn: string;
  status: BillStatus;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
};

const billColumns = {
  id: b.id,
  enrollmentId: b.enrollmentId,
  studentName: schema.students.name,
  className: schema.classes.name,
  feeTypeId: b.feeTypeId,
  feeTypeName: schema.feeTypes.name,
  period: b.period,
  title: b.title,
  total: b.total,
  dueOn: b.dueOn,
  status: b.status,
  paidAt: b.paidAt,
  voidedAt: b.voidedAt,
  voidReason: b.voidReason,
};

const joined = (tx: Tx) =>
  tx
    .select(billColumns)
    .from(b)
    .innerJoin(e, eq(e.id, b.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .innerJoin(schema.feeTypes, eq(schema.feeTypes.id, b.feeTypeId));

/** `overdue: true` keeps open bills with a part unpaid past its date; `false` (or absent) does not filter. */
function conditions(tx: Tx, q: Pick<BillsQuery, 'status' | 'feeTypeId' | 'classId' | 'enrollmentId' | 'period' | 'overdue'>, today: string) {
  const unpaidPast = exists(tx.select({ one: sql`1` }).from(i).where(and(eq(i.billId, b.id), isNull(i.paidAt), lt(i.dueOn, today))));
  return and(
    q.status ? eq(b.status, q.status) : undefined,
    q.feeTypeId ? eq(b.feeTypeId, q.feeTypeId) : undefined,
    q.classId ? eq(e.classId, q.classId) : undefined,
    q.enrollmentId ? eq(b.enrollmentId, q.enrollmentId) : undefined,
    q.period ? eq(b.period, q.period) : undefined,
    q.overdue ? and(eq(b.status, 'open'), unpaidPast) : undefined,
  );
}

/** Soonest due first, then by student, so a page of overdue bills starts with the longest overdue. */
export async function listBills(tx: Tx, q: BillsQuery, today: string): Promise<{ rows: BillRow[]; total: number }> {
  const where = conditions(tx, q, today);
  const rows = await joined(tx).where(where).orderBy(asc(b.dueOn), asc(schema.classes.name), asc(schema.students.name), desc(b.id)).limit(q.limit);
  const [counted] = await tx.select({ n: count() }).from(b).innerJoin(e, eq(e.id, b.enrollmentId)).where(where);
  return { rows, total: counted?.n ?? 0 };
}

export async function findBill(tx: Tx, id: string): Promise<BillRow | undefined> {
  const [row] = await joined(tx).where(eq(b.id, id));
  return row;
}

export function installmentsOf(tx: Tx, billIds: string[]): Promise<InstallmentRow[]> {
  if (billIds.length === 0) return Promise.resolve([]);
  return tx
    .select({ id: i.id, billId: i.billId, number: i.number, amount: i.amount, dueOn: i.dueOn, paidAt: i.paidAt })
    .from(i)
    .where(inArray(i.billId, billIds))
    .orderBy(asc(i.billId), asc(i.number));
}

/** Row lock on a bill (the column grant on student_bills allows FOR UPDATE). */
export async function lockBill(tx: Tx, id: string): Promise<{ id: string; status: BillStatus } | undefined> {
  const [row] = await tx.select({ id: b.id, status: b.status }).from(b).where(eq(b.id, id)).for('update');
  return row;
}

export async function hasPaidInstallment(tx: Tx, billId: string): Promise<boolean> {
  const [row] = await tx.select({ n: count() }).from(i).where(and(eq(i.billId, billId), sql`${i.paidAt} is not null`));
  return (row?.n ?? 0) > 0;
}

export function markVoid(tx: Tx, id: string, reason: string, at: Date) {
  return tx.update(b).set({ status: 'void', voidedAt: at, voidReason: reason }).where(eq(b.id, id));
}

/** Rombel of the active academic year with their active students: what a mass issue can be aimed at. */
export async function billableClasses(tx: Tx) {
  return tx
    .select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade, activeStudents: sql<number>`count(${e.id}) filter (where ${e.status} = 'active')::int` })
    .from(schema.classes)
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, schema.classes.academicYearId), eq(schema.academicYears.isActive, true)))
    .leftJoin(e, eq(e.classId, schema.classes.id))
    .groupBy(schema.classes.id)
    .orderBy(asc(schema.classes.grade), asc(schema.classes.name), asc(schema.classes.id));
}
