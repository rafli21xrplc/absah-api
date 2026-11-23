import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PlannedSession } from '../domain/session-plan';
import { computeDailyStatus } from '../domain/status-rules';

/** Schools the jobs run for (withPlatform: across tenants). */
export const listSchools = (tx: Tx) =>
  tx
    .select({ id: schema.schools.id, timezone: schema.schools.timezone, level: schema.schools.level, isMadrasah: schema.schools.isMadrasah })
    .from(schema.schools)
    .orderBy(asc(schema.schools.id));
export type JobSchool = Awaited<ReturnType<typeof listSchools>>[number];

export async function findSchool(tx: Tx, id: string): Promise<JobSchool | undefined> {
  const [row] = await tx
    .select({ id: schema.schools.id, timezone: schema.schools.timezone, level: schema.schools.level, isMadrasah: schema.schools.isMadrasah })
    .from(schema.schools)
    .where(eq(schema.schools.id, id));
  return row;
}

/** Serializes the jobs of one school day (generate and lock may overlap after a restart). */
export async function lockAttendanceDay(tx: Tx, schoolId: string, date: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attendance-day:${schoolId}:${date}`}, 0))`);
}

export async function findDay(tx: Tx, date: string) {
  const [row] = await tx.select().from(schema.attendanceDays).where(eq(schema.attendanceDays.schoolDate, date));
  return row;
}

export async function markDay(tx: Tx, schoolId: string, date: string, values: { generatedAt?: Date; skippedReason?: string; lockedAt?: Date }) {
  await tx
    .insert(schema.attendanceDays)
    .values({ schoolId, schoolDate: date, ...values })
    .onConflictDoUpdate({ target: [schema.attendanceDays.schoolId, schema.attendanceDays.schoolDate], set: values });
}

export const unlockedDays = (tx: Tx) =>
  tx.select({ schoolDate: schema.attendanceDays.schoolDate }).from(schema.attendanceDays).where(isNull(schema.attendanceDays.lockedAt));

export async function activeYearId(tx: Tx): Promise<string | null> {
  const [row] = await tx.select({ id: schema.academicYears.id }).from(schema.academicYears).where(eq(schema.academicYears.isActive, true));
  return row?.id ?? null;
}

export async function calendarKind(tx: Tx, date: string) {
  const [row] = await tx.select({ kind: schema.calendarDays.kind }).from(schema.calendarDays).where(eq(schema.calendarDays.date, date));
  return row?.kind ?? null;
}

export async function daysWithPeriods(tx: Tx): Promise<Set<number>> {
  const rows = await tx.selectDistinct({ day: schema.schedulePeriods.day }).from(schema.schedulePeriods);
  return new Set(rows.map((r) => r.day));
}

export const classesOfYear = (tx: Tx, academicYearId: string) =>
  tx
    .select({ id: schema.classes.id, homeroomTeacherId: schema.classes.homeroomTeacherId })
    .from(schema.classes)
    .where(eq(schema.classes.academicYearId, academicYearId))
    .orderBy(asc(schema.classes.name));

export const slotsOfDay = (tx: Tx, academicYearId: string, day: number) =>
  tx
    .select({ id: schema.scheduleSlots.id, ownerType: schema.scheduleSlots.ownerType, ownerId: schema.scheduleSlots.ownerId, teacherId: schema.scheduleSlots.teacherId })
    .from(schema.scheduleSlots)
    .where(and(eq(schema.scheduleSlots.academicYearId, academicYearId), eq(schema.scheduleSlots.day, day)))
    .orderBy(asc(schema.scheduleSlots.period));

export const activitiesOfYear = (tx: Tx, academicYearId: string) =>
  tx
    .select({ id: schema.activities.id, days: schema.activities.days, startsOn: schema.activities.startsOn, endsOn: schema.activities.endsOn, active: schema.activities.active })
    .from(schema.activities)
    .where(eq(schema.activities.academicYearId, academicYearId));

/**
 * PKL placements running on `date` (not cancelled, active enrollment) with their DUDI's work days
 * (PKL-02). Read here like activities: the session engine owns the sessions of every mode.
 */
export async function pklPlacementsOn(tx: Tx, date: string) {
  const res = await tx.execute<{ id: string; starts_on: string; ends_on: string; work_days: number[] }>(sql`
    select p.id, p.starts_on::text, p.ends_on::text,
           coalesce((select array_agg(h.day::int order by h.day) from dudi_work_hours h where h.partner_id = p.partner_id), '{}') as work_days
      from pkl_placements p
      join enrollments e on e.id = p.enrollment_id
     where p.status = 'active' and e.status = 'active' and p.starts_on <= ${date}::date and p.ends_on >= ${date}::date`);
  return res.rows.map((r) => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, workDays: r.work_days }));
}

/** The activity session of a date, if there is one. */
export async function activitySessionOf(tx: Tx, activityId: string, date: string): Promise<string | null> {
  const s = schema.attendanceSessions;
  const [row] = await tx.select({ id: s.id }).from(s).where(and(eq(s.activityId, activityId), eq(s.schoolDate, date), eq(s.mode, 'activity')));
  return row?.id ?? null;
}

/** Makes sure the day is known to the lock job (a coach may open a session on a day without lessons). */
export async function ensureDay(tx: Tx, schoolId: string, date: string): Promise<void> {
  await tx.insert(schema.attendanceDays).values({ schoolId, schoolDate: date }).onConflictDoNothing();
}

/** Inserts the planned sessions; ones that already exist (same slot or owner that day) are kept. */
export async function insertSessions(tx: Tx, schoolId: string, schoolDate: string, plan: PlannedSession[]): Promise<number> {
  if (plan.length === 0) return 0;
  const rows = await tx
    .insert(schema.attendanceSessions)
    .values(plan.map((p) => ({ schoolId, schoolDate, ...p })))
    .onConflictDoNothing()
    .returning({ id: schema.attendanceSessions.id });
  return rows.length;
}

/** Open sessions of a day not reminded yet, with the end of their lesson. */
export async function unremindedSessions(tx: Tx, date: string) {
  const s = schema.attendanceSessions;
  const slot = schema.scheduleSlots;
  const p = schema.schedulePeriods;
  return tx
    .select({ id: s.id, mode: s.mode, teacherId: s.teacherId, periodEndsAt: p.endsAt })
    .from(s)
    .leftJoin(slot, eq(slot.id, s.slotId))
    .leftJoin(p, and(eq(p.schoolId, s.schoolId), eq(p.day, slot.day), eq(p.number, slot.period)))
    .where(and(eq(s.schoolDate, date), eq(s.status, 'open'), isNull(s.remindedAt), isNotNull(s.teacherId)));
}

export async function markReminded(tx: Tx, ids: string[], at: Date): Promise<void> {
  if (ids.length) await tx.update(schema.attendanceSessions).set({ remindedAt: at }).where(inArray(schema.attendanceSessions.id, ids));
}

/** Locks every session of a day: open ones become missed, the rest locked. */
export async function lockSessions(tx: Tx, date: string, at: Date): Promise<{ sessions: number; missed: number }> {
  const s = schema.attendanceSessions;
  const rows = await tx
    .update(s)
    .set({ status: sql`case when ${s.status} = 'open' then 'missed'::session_status else 'locked'::session_status end`, lockedAt: at })
    .where(and(eq(s.schoolDate, date), isNull(s.lockedAt)))
    .returning({ status: s.status });
  return { sessions: rows.length, missed: rows.filter((r) => r.status === 'missed').length };
}

/**
 * Recomputes daily_attendance of a school date from the records of that day's class, group and PKL
 * sessions (a PKL day at the DUDI is the student's school day; activity sessions keep their own
 * rekap), for all students or only `enrollmentIds`.
 */
export async function recomputeDaily(tx: Tx, schoolId: string, date: string, enrollmentIds?: string[]): Promise<number> {
  const r = schema.attendanceRecords;
  const s = schema.attendanceSessions;
  const where = [eq(s.schoolDate, date), inArray(s.mode, ['per_period', 'daily', 'pkl'])];
  if (enrollmentIds) {
    if (enrollmentIds.length === 0) return 0;
    where.push(inArray(r.enrollmentId, enrollmentIds));
  }
  const records = await tx
    .select({ enrollmentId: r.enrollmentId, status: r.status })
    .from(r)
    .innerJoin(s, eq(s.id, r.sessionId))
    .where(and(...where));
  const byStudent = new Map<string, { status: (typeof records)[number]['status'] }[]>();
  for (const rec of records) byStudent.set(rec.enrollmentId, [...(byStudent.get(rec.enrollmentId) ?? []), rec]);
  const rows = [...byStudent].flatMap(([enrollmentId, recs]) => {
    const status = computeDailyStatus(recs);
    return status ? [{ schoolId, enrollmentId, schoolDate: date, status }] : [];
  });
  if (rows.length === 0) return 0;
  await tx
    .insert(schema.dailyAttendance)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.dailyAttendance.enrollmentId, schema.dailyAttendance.schoolDate],
      set: { status: sql`excluded.status`, computedAt: sql`now()` },
    });
  return rows.length;
}
