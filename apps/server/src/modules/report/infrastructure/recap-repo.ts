import type { ClassStream } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

const c = schema.classes;
const e = schema.enrollments;
const st = schema.students;
const d = schema.dailyAttendance;
const s = schema.attendanceSessions;

const memberName = (userId: SQL | typeof c.homeroomTeacherId) =>
  sql<string | null>`(select m.name from school_member_directory m where m.user_id = ${userId} limit 1)`;
const days = (status: string) => sql<number>`count(${d.schoolDate}) filter (where ${d.status} = ${status})::int`;
const statusCounts = { H: days('H'), T: days('T'), S: days('S'), I: days('I'), A: days('A') };

/** Enrollments of a rombel that overlap the period. */
const overlaps = (from: string, to: string) => and(lte(e.startsOn, to), or(isNull(e.endsOn), gte(e.endsOn, from)));
/** Rekap rows of the period only. */
const dailyJoin = (from: string, to: string) => and(eq(d.enrollmentId, e.id), gte(d.schoolDate, from), lte(d.schoolDate, to));

export function activeSemesters(tx: Tx) {
  const y = schema.academicYears;
  const sem = schema.semesters;
  return tx
    .select({ id: sem.id, academicYear: y.name, number: sem.number, startsOn: sem.startsOn, endsOn: sem.endsOn })
    .from(sem)
    .innerJoin(y, and(eq(y.id, sem.academicYearId), eq(y.isActive, true)))
    .orderBy(asc(sem.number));
}

/** Rombel of the active year; onlyHomeroomOf limits them to one wali kelas. */
export function activeClasses(tx: Tx, onlyHomeroomOf: string | null, stream?: ClassStream) {
  return tx
    .select({ id: c.id, name: c.name, grade: c.grade, stream: c.stream, homeroomId: c.homeroomTeacherId, homeroomName: memberName(c.homeroomTeacherId) })
    .from(c)
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, c.academicYearId), eq(schema.academicYears.isActive, true)))
    .where(and(onlyHomeroomOf ? eq(c.homeroomTeacherId, onlyHomeroomOf) : undefined, stream ? eq(c.stream, stream) : undefined))
    .orderBy(asc(c.grade), asc(c.name));
}

export async function findClass(tx: Tx, classId: string) {
  const [row] = await tx
    .select({ id: c.id, name: c.name, grade: c.grade, homeroomId: c.homeroomTeacherId, homeroomName: memberName(c.homeroomTeacherId) })
    .from(c)
    .where(eq(c.id, classId));
  return row ?? null;
}

/** Per rombel: students enrolled in the period and their rekap days by status. */
export function classCounts(tx: Tx, classIds: string[], from: string, to: string) {
  if (classIds.length === 0) return Promise.resolve([]);
  return tx
    .select({ classId: e.classId, students: sql<number>`count(distinct ${e.id})::int`, ...statusCounts })
    .from(e)
    .leftJoin(d, dailyJoin(from, to))
    .where(and(inArray(e.classId, classIds), overlaps(from, to)))
    .groupBy(e.classId);
}

/** Per enrollment of one rombel in the period, by student name. */
export function studentCounts(tx: Tx, classId: string, from: string, to: string) {
  return tx
    .select({
      enrollmentId: e.id,
      studentId: st.id,
      name: st.name,
      nisn: st.nisn,
      localId: st.localId,
      active: sql<boolean>`(${e.status} = 'active' and (${e.endsOn} is null or ${e.endsOn} >= ${to}))`,
      ...statusCounts,
    })
    .from(e)
    .innerJoin(st, eq(st.id, e.studentId))
    .leftJoin(d, dailyJoin(from, to))
    .where(and(eq(e.classId, classId), overlaps(from, to)))
    .groupBy(e.id, st.id)
    .orderBy(asc(st.name), asc(e.startsOn));
}

const sessions = (where: SQL) => sql<number>`count(*) filter (where ${where})::int`;

/** RKP-04: class and daily sessions in the period, counted per teacher per day. */
export function complianceRows(tx: Tx, from: string, to: string) {
  return tx
    .select({
      teacherId: s.teacherId,
      date: s.schoolDate,
      sessions: sql<number>`count(*)::int`,
      filled: sessions(sql`${s.status} in ('submitted', 'locked')`),
      filledLate: sessions(sql`${s.status} in ('submitted', 'locked') and ${s.remindedAt} is not null and ${s.submittedAt} > ${s.remindedAt}`),
      missed: sessions(sql`${s.status} = 'missed'`),
      open: sessions(sql`${s.status} = 'open'`),
    })
    .from(s)
    .where(and(gte(s.schoolDate, from), lte(s.schoolDate, to), inArray(s.mode, ['per_period', 'daily'])))
    .groupBy(s.teacherId, s.schoolDate);
}

export async function memberNames(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const ids = sql.join(
    userIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await tx.execute(sql`select distinct on (user_id) user_id, name from school_member_directory where user_id in (${ids})`);
  return new Map((result.rows as { user_id: string; name: string }[]).map((r) => [r.user_id, r.name]));
}
