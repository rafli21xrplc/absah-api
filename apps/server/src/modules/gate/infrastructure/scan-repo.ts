import type { ArrivalOutcome, ScanRejectReason, ScanResult } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

const g = schema.gateScans;
const c = schema.cards;
const e = schema.enrollments;

/** Cards with a bound phone and an active enrollment this year, for the kiosk roster. */
export function kioskRoster(tx: Tx) {
  return tx
    .select({ cardId: c.id, deviceId: c.activeDeviceId, name: schema.students.name, className: schema.classes.name })
    .from(c)
    .innerJoin(schema.students, eq(schema.students.id, c.studentId))
    .innerJoin(e, and(eq(e.studentId, c.studentId), eq(e.status, 'active')))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(isNotNull(c.activeDeviceId))
    .orderBy(asc(schema.classes.name), asc(schema.students.name));
}

/** The card, its bound device and the student's active enrollment. */
export async function cardForScan(tx: Tx, cardId: string) {
  const [row] = await tx
    .select({ cardId: c.id, activeDeviceId: c.activeDeviceId, enrollmentId: e.id, name: schema.students.name })
    .from(c)
    .innerJoin(schema.students, eq(schema.students.id, c.studentId))
    .leftJoin(e, and(eq(e.studentId, c.studentId), eq(e.status, 'active')))
    .where(eq(c.id, cardId));
  return row;
}

/** Earlier answers for these client events of this kiosk (a retried batch). */
export async function knownScans(tx: Tx, kioskDeviceId: string, clientEventIds: string[]) {
  return tx
    .select({ clientEventId: g.clientEventId, result: g.result, rejectReason: g.rejectReason, outcome: g.outcome, name: schema.students.name })
    .from(g)
    .leftJoin(e, eq(e.id, g.enrollmentId))
    .leftJoin(schema.students, eq(schema.students.id, e.studentId))
    .where(and(eq(g.kioskDeviceId, kioskDeviceId), inArray(g.clientEventId, clientEventIds)));
}

export interface ScanRow {
  schoolId: string;
  schoolDate: string;
  scannedAt: Date;
  method: 'qr' | 'manual';
  result: ScanResult;
  rejectReason?: ScanRejectReason | null;
  outcome?: ArrivalOutcome | null;
  enrollmentId?: string | null;
  cardId?: string | null;
  deviceId?: string | null;
  kioskDeviceId?: string | null;
  clientEventId?: string | null;
  recordedBy?: string | null;
  reason?: string | null;
}

/**
 * Inserts a scan; false when a unique index refused it (that client event is already stored, or
 * an accepted arrival already exists for the student that day).
 */
export async function insertScan(tx: Tx, row: ScanRow): Promise<string | null> {
  const [inserted] = await tx.insert(g).values(row).onConflictDoNothing().returning({ id: g.id });
  return inserted?.id ?? null;
}
