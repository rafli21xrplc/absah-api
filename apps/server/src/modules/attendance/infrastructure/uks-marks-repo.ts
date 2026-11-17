import { schema, type Tx } from '@absah/db';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

const u = schema.uksVisits;
const s = schema.attendanceSessions;
const e = schema.enrollments;
const slot = schema.scheduleSlots;
const period = schema.schedulePeriods;

/**
 * The (session, student) pairs a "dipulangkan" UKS visit covers: the student's class and group
 * sessions of that school date (per_period, daily) that had not ended when the visit was recorded.
 * A daily session always counts; a lesson counts while its end time is after the visit (school
 * clock). Read here, not through student-affairs, because outbox consumers re-read the state.
 */
export function sentHomeCoverage(tx: Tx, timezone: string, filter: { uksVisitId: string } | { schoolDate: string }) {
  const inGroup = sql`exists (select 1 from learning_group_members m where m.learning_group_id = ${s.ownerId} and m.enrollment_id = ${e.id})`;
  const stillRunning = or(
    eq(s.mode, 'daily'),
    isNull(period.endsAt),
    sql`(${u.visitedAt} at time zone ${timezone})::time < ${period.endsAt}`,
  );
  const where: SQL[] = [eq(u.outcome, 'dipulangkan'), eq(e.status, 'active'), inArray(s.mode, ['per_period', 'daily'])];
  if (stillRunning) where.push(stillRunning);
  where.push('uksVisitId' in filter ? eq(u.id, filter.uksVisitId) : eq(u.schoolDate, filter.schoolDate));
  return tx
    .select({ sessionId: s.id, enrollmentId: e.id, uksVisitId: u.id, recordedBy: u.recordedBy })
    .from(u)
    .innerJoin(e, eq(e.id, u.enrollmentId))
    .innerJoin(s, and(eq(s.schoolDate, u.schoolDate), or(and(eq(s.ownerType, 'class'), eq(s.ownerId, e.classId)), and(eq(s.ownerType, 'group'), inGroup))))
    .leftJoin(slot, eq(slot.id, s.slotId))
    .leftJoin(period, and(eq(period.schoolId, s.schoolId), eq(period.day, slot.day), eq(period.number, slot.period)))
    .where(and(...where));
}
