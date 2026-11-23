import { schema, type Tx } from '@absah/db';
import { and, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';

const l = schema.leaveRequests;
const s = schema.attendanceSessions;
const e = schema.enrollments;

/**
 * The (session, student) pairs approved izin cover: class and group sessions (per_period, daily) in
 * the request's dates whose roster has the student, the same rule as roster(). Read here, not through
 * the leave module, because outbox consumers re-read the state (docs/architecture.md "Event outbox").
 */
export function approvedLeaveCoverage(tx: Tx, filter: { leaveRequestId: string } | { schoolDate: string }) {
  const inGroup = sql`exists (select 1 from learning_group_members m where m.learning_group_id = ${s.ownerId} and m.enrollment_id = ${e.id})`;
  const where: SQL[] = [eq(l.status, 'approved'), eq(e.status, 'active'), inArray(s.mode, ['per_period', 'daily'])];
  where.push('leaveRequestId' in filter ? eq(l.id, filter.leaveRequestId) : eq(s.schoolDate, filter.schoolDate));
  return tx
    .select({ sessionId: s.id, enrollmentId: e.id, kind: l.kind, leaveRequestId: l.id })
    .from(l)
    .innerJoin(e, eq(e.id, l.enrollmentId))
    .innerJoin(
      s,
      and(
        gte(s.schoolDate, l.startsOn),
        lte(s.schoolDate, l.endsOn),
        or(and(eq(s.ownerType, 'class'), eq(s.ownerId, e.classId)), and(eq(s.ownerType, 'group'), inGroup)),
      ),
    )
    .where(and(...where));
}
