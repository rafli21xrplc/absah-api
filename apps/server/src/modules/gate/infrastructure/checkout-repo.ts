import type { PickupEventStatus } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { classNameOf, homeroomOf } from './pickup-repo';

const pg = schema.pickupGuardians;
const pe = schema.pickupEvents;

/** Approved penjemput still valid on the date, with a photo, per card (the kiosk's morning list). */
export function pickupRoster(tx: Tx, date: string) {
  return tx
    .select({ cardId: schema.cards.id, id: pg.id, name: pg.name, relation: pg.relation, photoKey: pg.photoKey })
    .from(pg)
    .innerJoin(schema.cards, eq(schema.cards.studentId, pg.studentId))
    .where(and(eq(pg.status, 'approved'), isNull(pg.photoRemovedAt), or(isNull(pg.validUntil), gte(pg.validUntil, date))))
    .orderBy(asc(schema.cards.id), asc(pg.createdAt));
}

/** The penjemput as the kiosk may have seen it: of this student, approved at some point. */
export async function guardianForCheckout(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: pg.id, studentId: pg.studentId, name: pg.name, status: pg.status, decidedAt: pg.decidedAt, validUntil: pg.validUntil })
    .from(pg)
    .where(eq(pg.id, id));
  return row;
}

export async function eventsByClientId(tx: Tx, clientEventIds: string[]) {
  return tx
    .select({ id: pe.id, clientEventId: pe.clientEventId, status: pe.status, name: schema.students.name })
    .from(pe)
    .innerJoin(schema.students, eq(schema.students.id, pe.studentId))
    .where(inArray(pe.clientEventId, clientEventIds));
}

export interface PickupEventRow {
  id: string;
  schoolId: string;
  schoolDate: string;
  clientEventId: string;
  kioskId: string;
  studentId: string;
  enrollmentId: string;
  pickupGuardianId: string | null;
  pickupName: string;
  unlistedPhotoKey?: string | null;
  status: PickupEventStatus;
  checkedOutAt: Date | null;
}

/** Inserts unless the client event or (for a release) the student's release of the day exists. */
export async function insertEvent(tx: Tx, row: PickupEventRow): Promise<boolean> {
  const inserted = await tx.insert(pe).values(row).onConflictDoNothing().returning({ id: pe.id });
  return inserted.length > 0;
}

/** Qualified by hand: inside a raw subquery drizzle would print a bare column name. */
const eventStudent = sql.raw('"pickup_events"."student_id"');

const eventColumns = {
  id: pe.id,
  schoolDate: pe.schoolDate,
  studentId: pe.studentId,
  enrollmentId: pe.enrollmentId,
  studentName: schema.students.name,
  className: classNameOf(eventStudent),
  pickupName: pe.pickupName,
  pickupGuardianId: pe.pickupGuardianId,
  unlistedPhotoKey: pe.unlistedPhotoKey,
  photoRemovedAt: pe.photoRemovedAt,
  status: pe.status,
  createdAt: pe.createdAt,
  checkedOutAt: pe.checkedOutAt,
  decidedVia: pe.decidedVia,
  decidedAt: pe.decidedAt,
};
const events = (tx: Tx) => tx.select(eventColumns).from(pe).innerJoin(schema.students, eq(schema.students.id, pe.studentId));
export type PickupEventView = Awaited<ReturnType<ReturnType<typeof events>['execute']>>[number];

export async function findEvent(tx: Tx, id: string): Promise<PickupEventView | undefined> {
  const [row] = await events(tx).where(eq(pe.id, id));
  return row;
}

/** The day's check-outs, held first then newest; `homeroomUserId` limits them to that rombel. */
export function eventsOfDay(tx: Tx, date: string, homeroomUserId: string | null) {
  const day = eq(pe.schoolDate, date);
  return events(tx)
    .where(homeroomUserId ? and(day, homeroomOf(eventStudent, homeroomUserId)) : day)
    .orderBy(sql`${pe.status} = 'held' desc`, desc(pe.createdAt));
}

/** Unlisted requests of the student on the date (the parent's action link page). */
export function unlistedOfStudent(tx: Tx, studentId: string, date: string) {
  return events(tx)
    .where(and(eq(pe.studentId, studentId), eq(pe.schoolDate, date), isNotNull(pe.unlistedPhotoKey)))
    .orderBy(desc(pe.createdAt));
}

export async function lockEvent(tx: Tx, id: string) {
  const [row] = await tx.select({ id: pe.id, status: pe.status, studentId: pe.studentId, enrollmentId: pe.enrollmentId, schoolDate: pe.schoolDate, unlisted: isNotNull(pe.unlistedPhotoKey) }).from(pe).where(eq(pe.id, id)).for('update');
  return row;
}

/** Another release of the student that day (only one is allowed). */
export async function releasedOn(tx: Tx, enrollmentId: string, date: string, exceptId?: string): Promise<boolean> {
  const where = and(eq(pe.enrollmentId, enrollmentId), eq(pe.schoolDate, date), eq(pe.status, 'released'), exceptId ? ne(pe.id, exceptId) : undefined);
  return (await tx.$count(pe, where)) > 0;
}

export async function decideEvent(tx: Tx, id: string, values: { status: 'released' | 'denied' | 'expired'; decidedBy: string | null; decidedVia: 'guardian' | 'staff' | null; at: Date }) {
  await tx
    .update(pe)
    .set({ status: values.status, decidedBy: values.decidedBy, decidedVia: values.decidedVia, decidedAt: values.decidedVia ? values.at : null, ...(values.status === 'released' ? { checkedOutAt: values.at } : {}) })
    .where(eq(pe.id, id));
}

/** Held requests of past school dates, across schools (each school's own date). */
export async function expirePastHeld(tx: Tx): Promise<number> {
  const res = await tx.execute(sql`
    update pickup_events pe set status = 'expired'
      from schools s
     where s.id = pe.school_id and pe.status = 'held' and pe.school_date < (now() at time zone s.timezone)::date`);
  return res.rowCount ?? 0;
}

/** Unlisted photos older than the cutoff that are still stored (across schools). */
export function unlistedPhotosDue(tx: Tx, cutoff: Date) {
  return tx.select({ id: pe.id, photoKey: pe.unlistedPhotoKey }).from(pe).where(and(isNotNull(pe.unlistedPhotoKey), isNull(pe.photoRemovedAt), lt(pe.createdAt, cutoff)));
}

export async function markUnlistedPhotoRemoved(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(pe).set({ photoRemovedAt: at }).where(eq(pe.id, id));
}
