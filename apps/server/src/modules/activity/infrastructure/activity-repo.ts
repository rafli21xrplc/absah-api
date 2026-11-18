import { STAFF_ROLES } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';

const a = schema.activities;
const c = schema.activityCoaches;
const m = schema.activityMembers;
const e = schema.enrollments;

export async function activeYear(tx: Tx) {
  const [row] = await tx.select({ id: schema.academicYears.id }).from(schema.academicYears).where(eq(schema.academicYears.isActive, true)).limit(1);
  return row;
}

const memberCount = sql<number>`(select count(*)::int from activity_members am where am.activity_id = ${a.id})`;

/** Activities of a year; `coachId` limits them to the ones that user coaches. */
export function listActivities(tx: Tx, academicYearId: string, opts: { coachId?: string; id?: string } = {}) {
  const where = [eq(a.academicYearId, academicYearId)];
  if (opts.id) where.push(eq(a.id, opts.id));
  if (opts.coachId) where.push(sql`exists (select 1 from activity_coaches ac where ac.activity_id = ${a.id} and ac.user_id = ${opts.coachId}::uuid)`);
  return tx
    .select({
      id: a.id,
      name: a.name,
      kind: a.kind,
      location: a.location,
      days: a.days,
      startsOn: a.startsOn,
      endsOn: a.endsOn,
      active: a.active,
      memberCount,
    })
    .from(a)
    .where(and(...where))
    .orderBy(asc(a.name), asc(a.id));
}
export type ActivityRow = Awaited<ReturnType<typeof listActivities>>[number];

/** Coaches of these activities with their names (school_member_directory). */
export async function coachesOf(tx: Tx, activityIds: string[]) {
  if (activityIds.length === 0) return [];
  return tx
    .select({
      activityId: c.activityId,
      id: c.userId,
      // Qualified by hand: a bare "user_id" would bind to the view's own column.
      name: sql<string>`(select d.name from school_member_directory d where d.user_id = "activity_coaches"."user_id" limit 1)`,
    })
    .from(c)
    .where(inArray(c.activityId, activityIds))
    .orderBy(asc(c.createdAt), asc(c.userId));
}

export async function isCoach(tx: Tx, activityId: string, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: c.userId }).from(c).where(and(eq(c.activityId, activityId), eq(c.userId, userId)));
  return row !== undefined;
}

/** Of these users, the ones with an active staff membership in the school. */
export async function activeStaff(tx: Tx, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx.execute<{ user_id: string }>(sql`
    select distinct d.user_id from school_member_directory d
     where d.status = 'active'
       and d.role in (${sql.join(STAFF_ROLES.map((r) => sql`${r}`), sql`, `)})
       and d.user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Set(rows.rows.map((r) => r.user_id));
}

export async function insertActivity(tx: Tx, values: typeof a.$inferInsert): Promise<void> {
  await tx.insert(a).values(values);
}

export async function updateActivity(tx: Tx, id: string, values: Partial<typeof a.$inferInsert>): Promise<void> {
  await tx.update(a).set({ ...values, updatedAt: new Date() }).where(eq(a.id, id));
}

export async function replaceCoaches(tx: Tx, schoolId: string, activityId: string, userIds: string[]): Promise<void> {
  await tx.delete(c).where(eq(c.activityId, activityId));
  if (userIds.length > 0) await tx.insert(c).values(userIds.map((userId) => ({ schoolId, activityId, userId })));
}

const student = { enrollmentId: e.id, name: schema.students.name, className: schema.classes.name };

export function membersOf(tx: Tx, activityId: string) {
  return tx
    .select(student)
    .from(m)
    .innerJoin(e, eq(e.id, m.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(eq(m.activityId, activityId))
    .orderBy(asc(schema.classes.name), asc(schema.students.name), asc(e.id));
}

export async function activeEnrollmentIds(tx: Tx, academicYearId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: e.id })
    .from(e)
    .where(and(inArray(e.id, ids), eq(e.academicYearId, academicYearId), eq(e.status, 'active')));
  return new Set(rows.map((r) => r.id));
}

export async function replaceMembers(tx: Tx, schoolId: string, activityId: string, enrollmentIds: string[]): Promise<void> {
  await tx.delete(m).where(eq(m.activityId, activityId));
  if (enrollmentIds.length > 0) await tx.insert(m).values(enrollmentIds.map((enrollmentId) => ({ schoolId, activityId, enrollmentId })));
}

/** Active students of the year whose name contains the text (wildcards escaped), at most 20. */
export function searchStudents(tx: Tx, academicYearId: string, text: string) {
  const term = text.replace(/[%_\\]/g, (x) => `\\${x}`);
  return tx
    .select(student)
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.academicYearId, academicYearId), eq(e.status, 'active'), ilike(schema.students.name, `%${term}%`)))
    .orderBy(asc(schema.students.name), asc(e.id))
    .limit(20);
}

/** Status counts per student over the activity's sessions in a range (attendance_records, mode activity). */
export async function recapCounts(tx: Tx, activityId: string, from: string, to: string) {
  const res = await tx.execute<{ enrollment_id: string; status: string; n: number }>(sql`
    select r.enrollment_id, r.status::text as status, count(*)::int as n
      from attendance_records r
      join attendance_sessions s on s.id = r.session_id
     where s.activity_id = ${activityId}::uuid and s.mode = 'activity' and s.school_date between ${from}::date and ${to}::date
     group by 1, 2`);
  return res.rows;
}

export async function sessionCount(tx: Tx, activityId: string, from: string, to: string): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from attendance_sessions
     where activity_id = ${activityId}::uuid and mode = 'activity' and school_date between ${from}::date and ${to}::date`);
  return res.rows[0]?.n ?? 0;
}
