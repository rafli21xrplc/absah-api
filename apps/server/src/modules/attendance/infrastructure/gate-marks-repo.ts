import { schema, type Tx } from '@absah/db';
import { and, eq, inArray, min, or, sql, type SQL } from 'drizzle-orm';

const s = schema.attendanceSessions;
const e = schema.enrollments;
const g = schema.gateScans;

/** Start of the first jam pelajaran on an ISO weekday, or null without jam pelajaran. */
export async function firstLessonStart(tx: Tx, weekday: number): Promise<string | null> {
  const [row] = await tx.select({ startsAt: min(schema.schedulePeriods.startsAt) }).from(schema.schedulePeriods).where(eq(schema.schedulePeriods.day, weekday));
  return row?.startsAt ?? null;
}

/**
 * Accepted gate arrivals of a date (optionally one student) with the class and group sessions
 * whose roster has the student, and the lesson times of per_period sessions. Read here because
 * the gate module calls attendance (and generation re-applies them).
 */
export function arrivalCoverage(tx: Tx, filter: { schoolDate: string; enrollmentId?: string }) {
  const inGroup = sql`exists (select 1 from learning_group_members m where m.learning_group_id = ${s.ownerId} and m.enrollment_id = ${e.id})`;
  const p = schema.schedulePeriods;
  const slot = schema.scheduleSlots;
  const where: SQL[] = [eq(g.result, 'accepted'), eq(g.schoolDate, filter.schoolDate), eq(e.status, 'active'), inArray(s.mode, ['per_period', 'daily'])];
  if (filter.enrollmentId) where.push(eq(g.enrollmentId, filter.enrollmentId));
  return tx
    .select({ scanId: g.id, scannedAt: g.scannedAt, enrollmentId: e.id, sessionId: s.id, mode: s.mode, startsAt: p.startsAt, endsAt: p.endsAt })
    .from(g)
    .innerJoin(e, eq(e.id, g.enrollmentId))
    .innerJoin(
      s,
      and(eq(s.schoolDate, g.schoolDate), or(and(eq(s.ownerType, 'class'), eq(s.ownerId, e.classId)), and(eq(s.ownerType, 'group'), inGroup))),
    )
    .leftJoin(slot, eq(slot.id, s.slotId))
    .leftJoin(p, and(eq(p.schoolId, s.schoolId), eq(p.day, slot.day), eq(p.number, slot.period)))
    .where(and(...where));
}
