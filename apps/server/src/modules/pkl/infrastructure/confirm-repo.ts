import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

const c = schema.pklCheckins;
const pl = schema.pklPlacements;

/** The industry supervisor's students on a date: running placements and that day's check-in/out. */
export async function supervisedOn(tx: Tx, mentorId: string, date: string) {
  const rows = await tx
    .select({ placementId: pl.id, name: schema.students.name, className: schema.classes.name })
    .from(pl)
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, pl.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, schema.enrollments.classId))
    .where(and(eq(pl.industryMentorId, mentorId), eq(pl.status, 'active'), sql`${pl.startsOn} <= ${date}::date and ${pl.endsOn} >= ${date}::date`))
    .orderBy(asc(schema.students.name), asc(pl.id));
  const checkins =
    rows.length === 0
      ? []
      : await tx
          .select({
            id: c.id,
            placementId: c.placementId,
            kind: c.kind,
            recordedAt: c.recordedAt,
            confirmStatus: c.confirmStatus,
            late: c.late,
            decidedStatus: c.decidedStatus,
            disputeReason: c.disputeReason,
          })
          .from(c)
          .where(and(inArray(c.placementId, rows.map((r) => r.placementId)), eq(c.schoolDate, date)));
  return { rows, checkins };
}

/** Check-ins among `ids` whose placement this supervisor holds (any state). */
export async function mentorCheckins(tx: Tx, mentorId: string, ids: string[]) {
  return tx
    .select({ id: c.id, confirmStatus: c.confirmStatus, schoolDate: c.schoolDate })
    .from(c)
    .innerJoin(pl, eq(pl.id, c.placementId))
    .where(and(inArray(c.id, ids), eq(pl.industryMentorId, mentorId), eq(c.kind, 'in')));
}

export interface PendingCheckin {
  id: string;
  placementId: string;
  enrollmentId: string;
  schoolDate: string;
  late: boolean;
}

const pendingColumns = { id: c.id, placementId: c.placementId, enrollmentId: pl.enrollmentId, schoolDate: c.schoolDate, late: c.late };

/** Locks and returns this supervisor's pending check-ins of a date (optionally only `ids`). */
export function lockPendingOfMentor(tx: Tx, mentorId: string, date: string, ids?: string[]): Promise<PendingCheckin[]> {
  const where = [eq(pl.industryMentorId, mentorId), eq(c.schoolDate, date), eq(c.confirmStatus, 'pending')];
  if (ids) where.push(inArray(c.id, ids));
  return tx.select(pendingColumns).from(c).innerJoin(pl, eq(pl.id, c.placementId)).where(and(...where)).orderBy(asc(c.id)).for('update', { of: c });
}

/** Locks pending check-ins recorded before `before` (pkl.auto-confirm). */
export function lockPendingBefore(tx: Tx, before: Date): Promise<PendingCheckin[]> {
  return tx
    .select(pendingColumns)
    .from(c)
    .innerJoin(pl, eq(pl.id, c.placementId))
    .where(and(eq(c.confirmStatus, 'pending'), lt(c.recordedAt, before)))
    .orderBy(asc(c.id))
    .for('update', { of: c });
}

export async function markConfirmed(tx: Tx, ids: string[], by: string | null, at: Date): Promise<void> {
  if (ids.length > 0) await tx.update(c).set({ confirmStatus: 'confirmed', confirmedAt: at, confirmedBy: by }).where(inArray(c.id, ids));
}

export async function lockCheckin(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: c.id, kind: c.kind, schoolDate: c.schoolDate, confirmStatus: c.confirmStatus, industryMentorId: pl.industryMentorId })
    .from(c)
    .innerJoin(pl, eq(pl.id, c.placementId))
    .where(eq(c.id, id))
    .for('update', { of: c });
  return row;
}

export async function markDisputed(tx: Tx, id: string, by: string, reason: string, at: Date): Promise<void> {
  await tx.update(c).set({ confirmStatus: 'disputed', disputedAt: at, disputedBy: by, disputeReason: reason }).where(eq(c.id, id));
}
