import { schema, type Tx } from '@absah/db';
import { and, desc, eq, gte, min, or, sql } from 'drizzle-orm';

const a = schema.actionLinks;
const e = schema.enrollments;

/** The link with this token hash, locked when the caller is about to write through it. */
export async function findLink(tx: Tx, tokenHash: string, lock: boolean) {
  const query = tx.select().from(a).where(eq(a.tokenHash, tokenHash));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export const markOpened = (tx: Tx, id: string, at: Date) => tx.update(a).set({ lastOpenedAt: at }).where(eq(a.id, id));
export const spendWrite = (tx: Tx, id: string, leaveRequestId: string, at: Date) => tx.update(a).set({ writeUsedAt: at, leaveRequestId }).where(eq(a.id, id));
export const setCardDevice = (tx: Tx, id: string, deviceId: string) => tx.update(a).set({ cardDeviceId: deviceId }).where(eq(a.id, id));

export async function schoolOf(tx: Tx, schoolId: string) {
  const s = schema.schools;
  const [row] = await tx.select({ id: s.id, name: s.name, level: s.level, isMadrasah: s.isMadrasah, timezone: s.timezone }).from(s).where(eq(s.id, schoolId));
  return row;
}

/** The student's enrollment in the active year (any status), with name and class. */
export async function studentOf(tx: Tx, studentId: string) {
  const [row] = await tx
    .select({ name: schema.students.name, enrollmentId: e.id, status: e.status, className: schema.classes.name })
    .from(schema.students)
    .innerJoin(e, eq(e.studentId, schema.students.id))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(eq(schema.students.id, studentId))
    .orderBy(desc(e.startsOn))
    .limit(1);
  return row;
}

/** The student's day: rekap status, each session's current status, and the gate arrival. */
export async function dayOf(tx: Tx, enrollmentId: string, schoolDate: string) {
  const s = schema.attendanceSessions;
  const r = schema.attendanceRecords;
  const [daily] = await tx
    .select({ status: schema.dailyAttendance.status })
    .from(schema.dailyAttendance)
    .where(and(eq(schema.dailyAttendance.enrollmentId, enrollmentId), eq(schema.dailyAttendance.schoolDate, schoolDate)));
  // Sessions the student belongs to today: the class session or a lesson they have a record in.
  const sessions = await tx
    .select({ mode: s.mode, status: r.status })
    .from(s)
    .leftJoin(r, and(eq(r.sessionId, s.id), eq(r.enrollmentId, enrollmentId)))
    .where(and(eq(s.schoolDate, schoolDate), or(and(eq(s.ownerType, 'class'), sql`${s.ownerId} = (select class_id from enrollments where id = ${enrollmentId})`), eq(r.enrollmentId, enrollmentId))))
    .orderBy(s.createdAt);
  const [arrival] = await tx
    .select({ at: min(schema.gateScans.scannedAt) })
    .from(schema.gateScans)
    .where(and(eq(schema.gateScans.enrollmentId, enrollmentId), eq(schema.gateScans.schoolDate, schoolDate), eq(schema.gateScans.result, 'accepted')));
  return { status: daily?.status ?? null, sessions, arrivedAt: arrival?.at ?? null };
}

/** Izin of the student from `since` on, newest first; cancelled ones are left out. */
export function leavesOf(tx: Tx, enrollmentId: string, since: string) {
  const l = schema.leaveRequests;
  return tx
    .select({ id: l.id, kind: l.kind, startsOn: l.startsOn, endsOn: l.endsOn, status: l.status })
    .from(l)
    .where(and(eq(l.enrollmentId, enrollmentId), gte(l.endsOn, since), sql`${l.status} <> 'cancelled'`))
    .orderBy(desc(l.startsOn))
    .limit(10);
}
