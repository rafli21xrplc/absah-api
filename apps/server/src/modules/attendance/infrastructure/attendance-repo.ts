import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';

const s = schema.attendanceSessions;
const classes = schema.classes;
const groups = schema.learningGroups;
const slot = schema.scheduleSlots;
const period = schema.schedulePeriods;
const activities = schema.activities;

/** Active students of a session's rombel or learning group. */
const rosterSize = sql<number>`(case
  when ${s.ownerType} = 'class' then (select count(*) from enrollments e where e.class_id = ${s.ownerId} and e.status = 'active')
  when ${s.ownerType} = 'group' then (select count(*) from learning_group_members m join enrollments e on e.id = m.enrollment_id
    where m.learning_group_id = ${s.ownerId} and e.status = 'active')
  when ${s.ownerType} = 'activity' then (select count(*) from activity_members m join enrollments e on e.id = m.enrollment_id
    where m.activity_id = ${s.ownerId} and e.status = 'active')
  when ${s.ownerType} = 'placement' then (select count(*) from pkl_placements p join enrollments e on e.id = p.enrollment_id
    where p.id = ${s.ownerId} and e.status = 'active')
  else 0 end)::int`;
const coachIds = sql<string[]>`coalesce((select array_agg(ac.user_id order by ac.user_id) from activity_coaches ac where ac.activity_id = ${s.activityId}), '{}')`;
const ownerName = sql<string>`coalesce(${classes.name}, ${groups.name}, ${activities.name}, ${schema.dudiPartners.name}, '')`;

export interface SessionFilter {
  date?: string;
  id?: string;
  /** Sessions the user teaches, daily sessions of the rombel the user is wali kelas of, activity sessions they coach. */
  forUser?: string;
  /** Jurnal mengajar: per-period sessions of one teacher (or all) between two school dates, inclusive. */
  journal?: { from: string; to: string; teacherId?: string };
  /** AKD-10: sessions of a rombel and of learning groups with any of its active students (no activities). */
  forClass?: string;
  /** Leave out PKL sessions (Hari ini: they are handled on the PKL pages, one per student). */
  withoutPkl?: boolean;
}

export async function listSessions(tx: Tx, filter: SessionFilter) {
  const where: SQL[] = [];
  if (filter.date) where.push(eq(s.schoolDate, filter.date));
  if (filter.id) where.push(eq(s.id, filter.id));
  if (filter.withoutPkl) where.push(ne(s.mode, 'pkl'));
  if (filter.forUser) {
    const coaching = sql`exists (select 1 from activity_coaches ac where ac.activity_id = ${s.activityId} and ac.user_id = ${filter.forUser}::uuid)`;
    const mine = or(eq(s.teacherId, filter.forUser), and(eq(s.mode, 'daily'), eq(classes.homeroomTeacherId, filter.forUser)), and(eq(s.mode, 'activity'), coaching));
    if (mine) where.push(mine);
  }
  if (filter.forClass) {
    const groupOfClass = sql`exists (select 1 from learning_group_members m join enrollments e on e.id = m.enrollment_id
      where m.learning_group_id = ${s.ownerId} and e.class_id = ${filter.forClass}::uuid and e.status = 'active')`;
    const owned = or(and(eq(s.ownerType, 'class'), eq(s.ownerId, filter.forClass)), and(eq(s.ownerType, 'group'), groupOfClass));
    if (owned) where.push(owned);
  }
  if (filter.journal) {
    where.push(eq(s.mode, 'per_period'), gte(s.schoolDate, filter.journal.from), lte(s.schoolDate, filter.journal.to));
    if (filter.journal.teacherId) where.push(eq(s.teacherId, filter.journal.teacherId));
  }
  return tx
    .select({
      id: s.id,
      topic: s.topic,
      schoolDate: s.schoolDate,
      mode: s.mode,
      status: s.status,
      ownerType: s.ownerType,
      ownerId: s.ownerId,
      ownerName,
      homeroomTeacherId: classes.homeroomTeacherId,
      coachIds,
      teacherId: s.teacherId,
      teacherName: sql<string | null>`(select d.name from school_member_directory d where d.user_id = ${s.teacherId} limit 1)`,
      lockedAt: s.lockedAt,
      periodNumber: slot.period,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      subjectId: schema.subjects.id,
      subjectName: schema.subjects.name,
      students: rosterSize,
      filled: sql<number>`(select count(*) from attendance_records r where r.session_id = ${s.id})::int`,
      absent: sql<number>`(select count(*) from attendance_records r where r.session_id = ${s.id} and r.status in ('S', 'I', 'A'))::int`,
    })
    .from(s)
    .leftJoin(classes, and(eq(s.ownerType, 'class'), eq(classes.id, s.ownerId)))
    .leftJoin(groups, and(eq(s.ownerType, 'group'), eq(groups.id, s.ownerId)))
    .leftJoin(activities, and(eq(s.ownerType, 'activity'), eq(activities.id, s.ownerId)))
    .leftJoin(schema.pklPlacements, eq(schema.pklPlacements.id, s.pklPlacementId))
    .leftJoin(schema.dudiPartners, eq(schema.dudiPartners.id, schema.pklPlacements.partnerId))
    .leftJoin(slot, eq(slot.id, s.slotId))
    .leftJoin(period, and(eq(period.schoolId, s.schoolId), eq(period.day, slot.day), eq(period.number, slot.period)))
    .leftJoin(schema.subjects, eq(schema.subjects.id, slot.subjectId))
    .where(and(...where))
    .orderBy(sql`${period.startsAt} nulls first`, ownerName, asc(s.id));
}
export type SessionRow = Awaited<ReturnType<typeof listSessions>>[number];

export async function lockSessionRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(s).where(eq(s.id, id)).for('update');
  return row;
}

/** Active students of a rombel, learning group, activity or PKL placement (one), with their rombel name. */
export async function roster(tx: Tx, owner: { ownerType: string; ownerId: string }) {
  const e = schema.enrollments;
  const base = tx
    .select({ enrollmentId: e.id, studentId: e.studentId, name: schema.students.name, className: classes.name })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(classes, eq(classes.id, e.classId));
  if (owner.ownerType === 'class') {
    return base.where(and(eq(e.classId, owner.ownerId), eq(e.status, 'active'))).orderBy(asc(schema.students.name));
  }
  if (owner.ownerType === 'group') {
    const m = schema.learningGroupMembers;
    return base
      .innerJoin(m, eq(m.enrollmentId, e.id))
      .where(and(eq(m.learningGroupId, owner.ownerId), eq(e.status, 'active')))
      .orderBy(asc(schema.students.name));
  }
  if (owner.ownerType === 'activity') {
    const m = schema.activityMembers;
    return base
      .innerJoin(m, eq(m.enrollmentId, e.id))
      .where(and(eq(m.activityId, owner.ownerId), eq(e.status, 'active')))
      .orderBy(asc(classes.name), asc(schema.students.name));
  }
  if (owner.ownerType === 'placement') {
    const p = schema.pklPlacements;
    return base.innerJoin(p, eq(p.enrollmentId, e.id)).where(and(eq(p.id, owner.ownerId), eq(e.status, 'active')));
  }
  return [];
}

export const recordsOf = (tx: Tx, sessionId: string) =>
  tx
    .select({ enrollmentId: schema.attendanceRecords.enrollmentId, status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(eq(schema.attendanceRecords.sessionId, sessionId));

/** `topic`: undefined keeps the current one, null clears it. */
export async function markSubmitted(tx: Tx, id: string, userId: string, topic?: string | null): Promise<void> {
  await tx
    .update(s)
    .set({ status: 'submitted', submittedAt: new Date(), submittedBy: userId, ...(topic === undefined ? {} : { topic }) })
    .where(eq(s.id, id));
}

/** Name of a school member (school_member_directory view), for file names and headings. */
export async function memberName(tx: Tx, userId: string): Promise<string | null> {
  const rows = await tx.execute<{ name: string }>(sql`select name from school_member_directory where user_id = ${userId} limit 1`);
  return rows.rows[0]?.name ?? null;
}

/** Active students of a rombel with their daily status on a date (AKD-10). */
export const classStudentsOn = (tx: Tx, classId: string, date: string) => {
  const e = schema.enrollments;
  const d = schema.dailyAttendance;
  return tx
    .select({ enrollmentId: e.id, studentId: e.studentId, name: schema.students.name, daily: d.status })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .leftJoin(d, and(eq(d.enrollmentId, e.id), eq(d.schoolDate, date)))
    .where(and(eq(e.classId, classId), eq(e.status, 'active')))
    .orderBy(asc(schema.students.name));
};

/** Learning group memberships of a rombel's active students: which group sessions apply to whom. */
export const groupMembersOfClass = (tx: Tx, classId: string) => {
  const m = schema.learningGroupMembers;
  const e = schema.enrollments;
  return tx
    .select({ groupId: m.learningGroupId, enrollmentId: m.enrollmentId })
    .from(m)
    .innerJoin(e, eq(e.id, m.enrollmentId))
    .where(and(eq(e.classId, classId), eq(e.status, 'active')));
};

/** Records of many sessions at once. */
export const recordsOfSessions = (tx: Tx, sessionIds: string[]) =>
  sessionIds.length === 0
    ? Promise.resolve([])
    : tx
        .select({ sessionId: schema.attendanceRecords.sessionId, enrollmentId: schema.attendanceRecords.enrollmentId, status: schema.attendanceRecords.status })
        .from(schema.attendanceRecords)
        .where(inArray(schema.attendanceRecords.sessionId, sessionIds));

export const classHeader = async (tx: Tx, classId: string) => {
  const [row] = await tx.select({ id: classes.id, name: classes.name, homeroomTeacherId: classes.homeroomTeacherId }).from(classes).where(eq(classes.id, classId));
  return row ?? null;
};
