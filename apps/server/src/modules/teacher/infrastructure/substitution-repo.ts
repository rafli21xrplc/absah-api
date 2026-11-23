import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type AnyColumn } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const s = schema.attendanceSessions;
const sl = schema.scheduleSlots;
const lv = schema.teacherLeaves;
const sub = schema.sessionSubstitutions;
const name = (column: AnyColumn) => directoryName(column);

/** Teachers on approved izin on a school date, with the izin that says so. */
export async function leavesOn(tx: Tx, date: string) {
  return tx.select({ id: lv.id, userId: lv.userId, kind: lv.kind }).from(lv).where(and(eq(lv.status, 'approved'), lte(lv.startsOn, date), gte(lv.endsOn, date)));
}

/** Every change of teacher of the given sessions, oldest first. */
export async function substitutionRows(tx: Tx, sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  return tx
    .select({ sessionId: sub.sessionId, fromTeacherId: sub.fromTeacherId, fromTeacherName: name(sub.fromTeacherId), substituteId: sub.substituteId, substituteName: name(sub.substituteId), createdAt: sub.createdAt })
    .from(sub)
    .where(inArray(sub.sessionId, sessionIds))
    .orderBy(asc(sub.createdAt), asc(sub.id));
}

export type SubstitutionRow = Awaited<ReturnType<typeof substitutionRows>>[number];

/**
 * Teachers who already have something at the same time on that date: a timetable slot at the same weekday and period
 * (also learning groups), or a session of that date they hold (a substitution moved it to them). Daily sessions have
 * no period, so a teacher holding any daily session that date is busy.
 */
export async function busyTeachers(tx: Tx, input: { date: string; weekday: number; period: number | null }): Promise<Set<string>> {
  if (input.period === null) {
    const rows = await tx.select({ id: s.teacherId }).from(s).where(and(eq(s.schoolDate, input.date), eq(s.mode, 'daily'), isNotNull(s.teacherId)));
    return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
  }
  const bySlot = await tx
    .select({ id: sl.teacherId })
    .from(sl)
    .innerJoin(schema.academicYears, eq(schema.academicYears.id, sl.academicYearId))
    .where(and(eq(sl.day, input.weekday), eq(sl.period, input.period), isNotNull(sl.teacherId), lte(schema.academicYears.startsOn, input.date), gte(schema.academicYears.endsOn, input.date)));
  const bySession = await tx
    .select({ id: s.teacherId })
    .from(s)
    .innerJoin(sl, eq(sl.id, s.slotId))
    .where(and(eq(s.schoolDate, input.date), eq(sl.period, input.period), isNotNull(s.teacherId)));
  return new Set([...bySlot, ...bySession].flatMap((r) => (r.id ? [r.id] : [])));
}

/** Active staff who can stand in, one row per person. */
export async function substitutePool(tx: Tx, roles: readonly string[]): Promise<{ userId: string; name: string }[]> {
  const result = await tx.execute(sql`select distinct on (d.user_id) d.user_id as "userId", d.name from school_member_directory d
    where d.status = 'active' and d.role::text in (${sql.join(roles.map((r) => sql`${r}`), sql`, `)}) order by d.user_id`);
  return result.rows as { userId: string; name: string }[];
}

export async function checkedInOn(tx: Tx, date: string): Promise<Set<string>> {
  const rows = await tx.select({ id: schema.teacherAttendance.userId }).from(schema.teacherAttendance).where(eq(schema.teacherAttendance.schoolDate, date));
  return new Set(rows.map((r) => r.id));
}

/** Teachers who have a timetable slot of this subject in the school year of that date. */
export async function teachersOfSubject(tx: Tx, subjectId: string, date: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: sl.teacherId })
    .from(sl)
    .innerJoin(schema.academicYears, eq(schema.academicYears.id, sl.academicYearId))
    .where(and(eq(sl.subjectId, subjectId), isNotNull(sl.teacherId), lte(schema.academicYears.startsOn, date), gte(schema.academicYears.endsOn, date)));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/** How many sessions each person took over since the first of the month of `date`. */
export async function substitutionCounts(tx: Tx, date: string, timezone: string): Promise<Map<string, number>> {
  const monthStart = `${date.slice(0, 7)}-01`;
  const rows = await tx
    .select({ id: sub.substituteId, n: sql<number>`count(*)::int` })
    .from(sub)
    .where(sql`(${sub.createdAt} at time zone ${timezone})::date >= ${monthStart}::date`)
    .groupBy(sub.substituteId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** The session row locked for the change; only an open one can get a new teacher. */
export async function lockSession(tx: Tx, id: string) {
  const [row] = await tx.select({ id: s.id, schoolDate: s.schoolDate, mode: s.mode, status: s.status, lockedAt: s.lockedAt, teacherId: s.teacherId }).from(s).where(eq(s.id, id)).for('update');
  return row;
}

/** Serializes all assignments of one school date, so the same person cannot be given two sessions at one time. */
export async function lockSubstitutionsOn(tx: Tx, schoolId: string, date: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`substitute:${schoolId}:${date}`}, 0))`);
}

export async function moveSession(tx: Tx, input: { id: string; schoolId: string; fromTeacherId: string | null; substituteId: string; assignedBy: string; rowId: string }): Promise<void> {
  await tx.update(s).set({ teacherId: input.substituteId }).where(eq(s.id, input.id));
  await tx.insert(sub).values({ id: input.rowId, schoolId: input.schoolId, sessionId: input.id, fromTeacherId: input.fromTeacherId, substituteId: input.substituteId, assignedBy: input.assignedBy });
}
