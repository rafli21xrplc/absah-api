import type { LeaveKind, LeaveStatus } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { and, asc, desc, eq, exists, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';

const l = schema.leaveRequests;
const e = schema.enrollments;
const k = schema.classes;
const st = schema.students;
const name = (column: SQL | typeof l.requestedBy) => sql<string | null>`(select d.name from school_member_directory d where d.user_id = ${column} limit 1)`;

/** The student's guardian account is `userId` (guardians.user_id via student_guardians). */
const guardianOf = (tx: Tx, userId: string) =>
  exists(
    tx
      .select({ one: sql`1` })
      .from(schema.studentGuardians)
      .innerJoin(schema.guardians, eq(schema.guardians.id, schema.studentGuardians.guardianId))
      .where(and(eq(schema.studentGuardians.studentId, e.studentId), eq(schema.guardians.userId, userId))),
  );

/** Serializes requests of one student so two overlapping izin cannot both pass. */
export async function lockStudentLeave(tx: Tx, enrollmentId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`leave:${enrollmentId}`}, 0))`);
}

export async function findStudent(tx: Tx, enrollmentId: string, userId: string) {
  const [row] = await tx
    .select({ enrollmentId: e.id, status: e.status, homeroomTeacherId: k.homeroomTeacherId, isGuardian: guardianOf(tx, userId).mapWith(Boolean) })
    .from(e)
    .innerJoin(k, eq(k.id, e.classId))
    .where(eq(e.id, enrollmentId));
  return row;
}

/** Active students of the active year the user may request izin for (all of them for `all`). */
export function requestableStudents(tx: Tx, userId: string, all: boolean) {
  const where = [eq(e.status, 'active'), eq(schema.academicYears.isActive, true)];
  if (!all) where.push(or(eq(k.homeroomTeacherId, userId), guardianOf(tx, userId)) as SQL);
  return tx
    .select({ enrollmentId: e.id, name: st.name, className: k.name })
    .from(e)
    .innerJoin(st, eq(st.id, e.studentId))
    .innerJoin(k, eq(k.id, e.classId))
    .innerJoin(schema.academicYears, eq(schema.academicYears.id, e.academicYearId))
    .where(and(...where))
    .orderBy(asc(k.name), asc(st.name));
}

export async function hasOverlap(tx: Tx, enrollmentId: string, range: { startsOn: string; endsOn: string }): Promise<boolean> {
  const [row] = await tx
    .select({ id: l.id })
    .from(l)
    .where(and(eq(l.enrollmentId, enrollmentId), inArray(l.status, ['pending', 'approved']), lte(l.startsOn, range.endsOn), gte(l.endsOn, range.startsOn)))
    .limit(1);
  return row !== undefined;
}

export async function insertLeave(
  tx: Tx,
  values: {
    schoolId: string;
    enrollmentId: string;
    kind: LeaveKind;
    startsOn: string;
    endsOn: string;
    reason: string;
    attachmentKey: string | null;
    attachmentType: string | null;
    status: LeaveStatus;
    requestedBy: string;
    decidedBy: string | null;
    decidedAt: Date | null;
  },
): Promise<string> {
  const [row] = await tx
    .insert(l)
    .values({ ...values, reason: sensitive(values.reason) })
    .returning({ id: l.id });
  if (!row) throw new Error('leave request not inserted');
  return row.id;
}

export async function lockLeave(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: l.id, status: l.status, requestedBy: l.requestedBy, enrollmentId: l.enrollmentId, kind: l.kind, startsOn: l.startsOn, endsOn: l.endsOn })
    .from(l)
    .where(eq(l.id, id))
    .for('update');
  return row;
}

export async function updateLeave(
  tx: Tx,
  id: string,
  values: Partial<Pick<typeof l.$inferInsert, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'cancelledBy' | 'cancelledAt'>>,
): Promise<void> {
  await tx.update(l).set(values).where(eq(l.id, id));
}

/** Requests with student and names; `visibleTo` limits to the user's own, rombel or children. */
export function listLeaves(tx: Tx, filter: { status?: LeaveStatus; id?: string; visibleTo?: string }) {
  const where: SQL[] = [];
  if (filter.status) where.push(eq(l.status, filter.status));
  if (filter.id) where.push(eq(l.id, filter.id));
  if (filter.visibleTo) where.push(or(eq(l.requestedBy, filter.visibleTo), eq(k.homeroomTeacherId, filter.visibleTo), guardianOf(tx, filter.visibleTo)) as SQL);
  return tx
    .select({
      id: l.id,
      enrollmentId: l.enrollmentId,
      studentName: st.name,
      className: k.name,
      homeroomTeacherId: k.homeroomTeacherId,
      kind: l.kind,
      startsOn: l.startsOn,
      endsOn: l.endsOn,
      reason: l.reason,
      attachmentKey: l.attachmentKey,
      attachmentType: l.attachmentType,
      status: l.status,
      requestedBy: l.requestedBy,
      requestedByName: name(l.requestedBy),
      decidedBy: l.decidedBy,
      decidedByName: name(l.decidedBy),
      decidedAt: l.decidedAt,
      decisionNote: l.decisionNote,
      cancelledAt: l.cancelledAt,
      createdAt: l.createdAt,
    })
    .from(l)
    .innerJoin(e, eq(e.id, l.enrollmentId))
    .innerJoin(st, eq(st.id, e.studentId))
    .innerJoin(k, eq(k.id, e.classId))
    .where(and(...where))
    .orderBy(desc(l.createdAt))
    .limit(200);
}
export type LeaveRow = Awaited<ReturnType<typeof listLeaves>>[number];
