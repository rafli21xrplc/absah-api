import { schema, type Tx } from '@absah/db';
import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm';

const r = schema.examRooms;
const s = schema.examSeats;
const e = schema.enrollments;

// Qualified by hand: inside a single-table select Drizzle drops the table name from column references.
const roomColumns = {
  id: r.id,
  periodId: r.periodId,
  name: r.name,
  capacity: r.capacity,
  supervisorId: r.supervisorId,
  supervisorName: sql<string | null>`(select d.name from school_member_directory d where d.user_id = exam_rooms.supervisor_id limit 1)`,
  seated: sql<number>`(select count(*)::int from exam_seats x where x.room_id = exam_rooms.id)`,
};
export type RoomRow = NonNullable<Awaited<ReturnType<typeof findRoom>>>;

export function listRooms(tx: Tx, periodId: string) {
  return tx.select(roomColumns).from(r).where(eq(r.periodId, periodId)).orderBy(asc(r.name), asc(r.id));
}

export async function findRoom(tx: Tx, id: string) {
  const [row] = await tx.select(roomColumns).from(r).where(eq(r.id, id));
  return row;
}

/** Locks the room row so two arrangements of one room do not hand out the same seat number. */
export async function lockRoom(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`select 1 from ${r} where ${r.id} = ${id} for update`);
}

export function insertRoom(tx: Tx, row: typeof r.$inferInsert) {
  return tx.insert(r).values(row);
}
export function updateRoom(tx: Tx, id: string, fields: Partial<Pick<typeof r.$inferInsert, 'name' | 'capacity' | 'supervisorId'>>) {
  return tx.update(r).set(fields).where(eq(r.id, id));
}
export async function deleteRoom(tx: Tx, id: string) {
  await tx.delete(s).where(eq(s.roomId, id));
  await tx.delete(r).where(eq(r.id, id));
}

/** An active member of the school with a staff role (not a parent or student). */
export async function isStaffMember(tx: Tx, userId: string): Promise<boolean> {
  const m = schema.memberships;
  const rows = await tx.select({ id: m.id }).from(m).where(and(eq(m.userId, userId), eq(m.status, 'active'), notInArray(m.role, ['orang_tua', 'siswa']))).limit(1);
  return rows.length > 0;
}

export function seatsOfRoom(tx: Tx, roomId: string) {
  return tx
    .select({ enrollmentId: s.enrollmentId, seatNo: s.seatNo, name: schema.students.name, className: schema.classes.name })
    .from(s)
    .innerJoin(e, eq(e.id, s.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(eq(s.roomId, roomId))
    .orderBy(asc(s.seatNo));
}

export async function occupiedSeatNos(tx: Tx, roomId: string): Promise<number[]> {
  return (await tx.select({ seatNo: s.seatNo }).from(s).where(eq(s.roomId, roomId))).map((x) => x.seatNo);
}

/** Where these enrollments already sit in the period. */
export async function seatsInPeriod(tx: Tx, periodId: string, enrollmentIds: string[]) {
  if (enrollmentIds.length === 0) return new Map<string, { roomId: string; seatNo: number }>();
  const rows = await tx.select({ enrollmentId: s.enrollmentId, roomId: s.roomId, seatNo: s.seatNo }).from(s).where(and(eq(s.periodId, periodId), inArray(s.enrollmentId, enrollmentIds)));
  return new Map(rows.map((x) => [x.enrollmentId, { roomId: x.roomId, seatNo: x.seatNo }]));
}

export async function insertSeats(tx: Tx, rows: (typeof s.$inferInsert)[]) {
  if (rows.length > 0) await tx.insert(s).values(rows);
}
export async function moveSeat(tx: Tx, periodId: string, enrollmentId: string, roomId: string, seatNo: number) {
  await tx.update(s).set({ roomId, seatNo }).where(and(eq(s.periodId, periodId), eq(s.enrollmentId, enrollmentId)));
}
export async function deleteSeat(tx: Tx, roomId: string, enrollmentId: string): Promise<boolean> {
  const gone = await tx.delete(s).where(and(eq(s.roomId, roomId), eq(s.enrollmentId, enrollmentId))).returning({ id: s.id });
  return gone.length > 0;
}

/** Active enrollments of the period's year among these ids (or of a rombel), in rombel then student name order. */
export async function activeEnrollments(tx: Tx, academicYearId: string, filter: { ids: string[] } | { classId: string }): Promise<string[]> {
  const rows = await tx
    .select({ id: e.id })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .where(and(eq(e.academicYearId, academicYearId), eq(e.status, 'active'), 'ids' in filter ? inArray(e.id, filter.ids) : eq(e.classId, filter.classId)))
    .orderBy(asc(schema.students.name), asc(e.id));
  return rows.map((x) => x.id);
}

export async function unseatedCount(tx: Tx, academicYearId: string, periodId: string): Promise<number> {
  const [active] = await tx.select({ n: count() }).from(e).where(and(eq(e.academicYearId, academicYearId), eq(e.status, 'active')));
  const [seated] = await tx.select({ n: count() }).from(s).innerJoin(e, eq(e.id, s.enrollmentId)).where(and(eq(s.periodId, periodId), eq(e.academicYearId, academicYearId), eq(e.status, 'active')));
  return (active?.n ?? 0) - (seated?.n ?? 0);
}
