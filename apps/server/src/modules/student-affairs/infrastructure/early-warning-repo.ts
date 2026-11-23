import { schema, type Tx } from '@absah/db';
import type { EarlyWarningKind } from '@absah/contracts';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

const d = schema.dailyAttendance;
const r = schema.attendanceRecords;
const s = schema.attendanceSessions;
const w = schema.earlyWarnings;

/** True the first time a school date is handled, false after: the 5-minute cron after 18.00 then runs the day once. */
export async function markRun(tx: Tx, schoolId: string, date: string): Promise<boolean> {
  const inserted = await tx.insert(schema.earlyWarningRuns).values({ schoolId, schoolDate: date }).onConflictDoNothing().returning({ date: schema.earlyWarningRuns.schoolDate });
  return inserted.length > 0;
}

/** Rekap harian of active students over the window. */
export function dailyRows(tx: Tx, from: string, to: string) {
  return tx
    .select({ enrollmentId: d.enrollmentId, date: d.schoolDate, status: d.status })
    .from(d)
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, d.enrollmentId))
    .where(and(eq(schema.enrollments.status, 'active'), gte(d.schoolDate, from), sql`${d.schoolDate} <= ${to}`));
}

/** Days a student was present (H or T) yet marked A in a jam pelajaran. */
export function bolosRows(tx: Tx, from: string, to: string) {
  return tx
    .selectDistinct({ enrollmentId: r.enrollmentId, date: s.schoolDate })
    .from(r)
    .innerJoin(s, eq(s.id, r.sessionId))
    .innerJoin(d, and(eq(d.enrollmentId, r.enrollmentId), eq(d.schoolDate, s.schoolDate)))
    .where(and(eq(s.mode, 'per_period'), eq(r.status, 'A'), inArray(d.status, ['H', 'T']), gte(s.schoolDate, from), sql`${s.schoolDate} <= ${to}`));
}

/** PKL work days decided A. */
export function pklAbsenceRows(tx: Tx, from: string, to: string) {
  return tx
    .selectDistinct({ enrollmentId: r.enrollmentId, date: s.schoolDate })
    .from(r)
    .innerJoin(s, eq(s.id, r.sessionId))
    .where(and(eq(s.mode, 'pkl'), eq(r.status, 'A'), gte(s.schoolDate, from), sql`${s.schoolDate} <= ${to}`));
}

/** Warnings raised since `from`: the job does not repeat a kind for a student inside the cooldown. */
export function recentWarnings(tx: Tx, from: string) {
  return tx.select({ enrollmentId: w.enrollmentId, kind: w.kind }).from(w).where(gte(w.schoolDate, from));
}

export async function insertWarning(tx: Tx, row: { id: string; schoolId: string; enrollmentId: string; kind: EarlyWarningKind; schoolDate: string; dates: string[] }): Promise<boolean> {
  const inserted = await tx.insert(w).values(row).onConflictDoNothing().returning({ id: w.id });
  return inserted.length > 0;
}

/** Newest first, at most 200; homeroomTeacherId limits the list to one wali kelas's class. */
export function listWarnings(tx: Tx, filter: { from: string; homeroomTeacherId?: string }) {
  return tx
    .select({
      id: w.id,
      enrollmentId: w.enrollmentId,
      name: schema.students.name,
      className: schema.classes.name,
      kind: w.kind,
      schoolDate: w.schoolDate,
      dates: w.dates,
    })
    .from(w)
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, w.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, schema.enrollments.classId))
    .where(and(gte(w.schoolDate, filter.from), filter.homeroomTeacherId ? eq(schema.classes.homeroomTeacherId, filter.homeroomTeacherId) : undefined))
    .orderBy(desc(w.schoolDate), desc(w.id))
    .limit(200);
}
export type WarningRow = Awaited<ReturnType<typeof listWarnings>>[number];
