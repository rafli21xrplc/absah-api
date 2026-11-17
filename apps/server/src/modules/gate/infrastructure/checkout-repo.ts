import type { PickupEventStatus } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm';

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
