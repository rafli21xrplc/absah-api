import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AttendanceCounts } from '../domain/eligibility';

const e = schema.enrollments;

/** Active students of the period's academic year with their rombel, optionally one rombel or only the rombel of one wali kelas. */
export function studentsOf(tx: Tx, academicYearId: string, filter: { classId?: string; homeroomTeacherId?: string }) {
  return tx
    .select({ enrollmentId: e.id, name: schema.students.name, classId: schema.classes.id, className: schema.classes.name })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.academicYearId, academicYearId), eq(e.status, 'active'), filter.classId ? eq(e.classId, filter.classId) : undefined, filter.homeroomTeacherId ? eq(schema.classes.homeroomTeacherId, filter.homeroomTeacherId) : undefined))
    .orderBy(asc(schema.classes.name), asc(schema.students.name), asc(e.id));
}

/** A rombel of the school and who its wali kelas is. */
export async function findClass(tx: Tx, classId: string) {
  const [row] = await tx.select({ id: schema.classes.id, homeroomTeacherId: schema.classes.homeroomTeacherId }).from(schema.classes).where(eq(schema.classes.id, classId));
  return row;
}

/** Days with a record per status, per enrollment, from `from` to `to` inclusive. */
export async function attendanceCounts(tx: Tx, enrollmentIds: string[], from: string, to: string): Promise<Map<string, AttendanceCounts>> {
  const result = new Map<string, AttendanceCounts>();
  if (enrollmentIds.length === 0) return result;
  const d = schema.dailyAttendance;
  const rows = await tx
    .select({ enrollmentId: d.enrollmentId, status: d.status, n: sql<number>`count(*)::int` })
    .from(d)
    .where(and(inArray(d.enrollmentId, enrollmentIds), gte(d.schoolDate, from), lte(d.schoolDate, to)))
    .groupBy(d.enrollmentId, d.status);
  for (const r of rows) {
    const counts = result.get(r.enrollmentId) ?? { H: 0, T: 0, S: 0, I: 0, A: 0 };
    counts[r.status] = r.n;
    result.set(r.enrollmentId, counts);
  }
  return result;
}

/** Unpaid installments of open bills due on or before `dueBy`, per enrollment, for the fee types (all when the list is empty). */
export async function unpaidInstallmentCounts(tx: Tx, enrollmentIds: string[], dueBy: string, feeTypeIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (enrollmentIds.length === 0) return result;
  const i = schema.billInstallments;
  const b = schema.studentBills;
  const rows = await tx
    .select({ enrollmentId: b.enrollmentId, n: sql<number>`count(*)::int` })
    .from(i)
    .innerJoin(b, eq(b.id, i.billId))
    .where(and(inArray(b.enrollmentId, enrollmentIds), eq(b.status, 'open'), isNull(i.paidAt), lte(i.dueOn, dueBy), feeTypeIds.length > 0 ? inArray(b.feeTypeId, feeTypeIds) : undefined))
    .groupBy(b.enrollmentId);
  for (const r of rows) result.set(r.enrollmentId, r.n);
  return result;
}

export async function yearStart(tx: Tx, academicYearId: string): Promise<string> {
  const [row] = await tx.select({ startsOn: schema.academicYears.startsOn }).from(schema.academicYears).where(eq(schema.academicYears.id, academicYearId));
  return row?.startsOn ?? '1970-01-01';
}
