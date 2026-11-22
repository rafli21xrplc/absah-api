import { schema, type Tx } from '@absah/db';
import { and, eq, inArray } from 'drizzle-orm';

const a = schema.examAttendance;
const s = schema.examSeats;

/** A student's seat in one room. */
export async function seatInRoom(tx: Tx, roomId: string, enrollmentId: string) {
  const [row] = await tx
    .select({ seatNo: s.seatNo, name: schema.students.name })
    .from(s)
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, s.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .where(and(eq(s.roomId, roomId), eq(s.enrollmentId, enrollmentId)));
  return row;
}

/** Where a student (by person, as a card names them) sits in the period, whichever enrollment. */
export async function seatOfStudent(tx: Tx, periodId: string, studentId: string) {
  const [row] = await tx
    .select({ enrollmentId: s.enrollmentId, roomId: s.roomId, roomName: schema.examRooms.name })
    .from(s)
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, s.enrollmentId))
    .innerJoin(schema.examRooms, eq(schema.examRooms.id, s.roomId))
    .where(and(eq(s.periodId, periodId), eq(schema.enrollments.studentId, studentId)));
  return row;
}

/** The room a student sits in for the period, by enrollment. */
export async function roomNameOf(tx: Tx, periodId: string, enrollmentId: string): Promise<string | undefined> {
  const [row] = await tx.select({ name: schema.examRooms.name }).from(s).innerJoin(schema.examRooms, eq(schema.examRooms.id, s.roomId)).where(and(eq(s.periodId, periodId), eq(s.enrollmentId, enrollmentId)));
  return row?.name;
}

export type CheckInRow = typeof a.$inferSelect;

/** Records the arrival; null when the student was already checked in for the period (the caller then reads the earlier one). */
export async function insertCheckIn(tx: Tx, row: typeof a.$inferInsert): Promise<CheckInRow | null> {
  const [inserted] = await tx.insert(a).values(row).onConflictDoNothing({ target: [a.periodId, a.enrollmentId] }).returning();
  return inserted ?? null;
}

export async function findCheckIn(tx: Tx, periodId: string, enrollmentId: string) {
  const [row] = await tx.select().from(a).where(and(eq(a.periodId, periodId), eq(a.enrollmentId, enrollmentId)));
  return row;
}

export async function checkInsOfRoom(tx: Tx, roomId: string): Promise<Map<string, { checkedInAt: Date; method: string }>> {
  const rows = await tx.select({ enrollmentId: a.enrollmentId, checkedInAt: a.checkedInAt, method: a.method }).from(a).where(eq(a.roomId, roomId));
  return new Map(rows.map((r) => [r.enrollmentId, { checkedInAt: r.checkedInAt, method: r.method }]));
}

export async function roomHasCheckIns(tx: Tx, roomId: string): Promise<boolean> {
  return (await tx.select({ id: a.id }).from(a).where(eq(a.roomId, roomId)).limit(1)).length > 0;
}

/** Which of these enrollments have already arrived for the period. */
export async function checkedInAmong(tx: Tx, periodId: string, enrollmentIds: string[]): Promise<string[]> {
  if (enrollmentIds.length === 0) return [];
  return (await tx.select({ id: a.enrollmentId }).from(a).where(and(eq(a.periodId, periodId), inArray(a.enrollmentId, enrollmentIds)))).map((r) => r.id);
}
