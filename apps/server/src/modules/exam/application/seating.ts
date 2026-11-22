import type { RoomRoster, SeatStudentsRequest, SeatStudentsResult } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { anyRole, type Actor } from '../../../shared/policy';
import { planSeating } from '../domain/seating';
import { canManageExams } from '../domain/policies';
import { checkedInAmong } from '../infrastructure/attendance-repo';
import { findPeriod } from '../infrastructure/period-repo';
import { activeEnrollments, deleteSeat, findRoom, insertSeats, lockRoom, moveSeat, occupiedSeatNos, seatsInPeriod, seatsOfRoom } from '../infrastructure/room-repo';
import { viewRoom } from './rooms';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const seesAllRooms = anyRole('wakasek', 'kepsek', 'admin');

/**
 * POST /exam/rooms/{id}/students: seat a rombel or named students. Those in another room of the period move; the
 * numbers are the lowest free ones. Refuses (409 room_full) a plan that would pass the room's capacity, and
 * (400) ids that are not active students of the period's academic year; nothing is changed then.
 */
export function seatStudents(actor: Actor, auditCtx: AuditContext, roomId: string, input: SeatStudentsRequest): Promise<SeatStudentsResult> {
  authorize(actor, canManageExams);
  return withTenant(scope(actor), async (tx) => {
    const room = await findRoom(tx, roomId);
    if (!room) throw new NotFoundError('Ruang tidak ditemukan.');
    const period = await findPeriod(tx, room.periodId);
    if (!period) throw new NotFoundError('Ujian tidak ditemukan.');
    if (period.closedAt) throw new ConflictError('Ujian sudah ditutup.', { reason: 'period_closed' });
    const ids = 'classId' in input ? await activeEnrollments(tx, period.academicYearId, { classId: input.classId }) : [...new Set(input.enrollmentIds)];
    if ('classId' in input && ids.length === 0) throw new ValidationError([{ path: 'classId', message: 'Rombel tidak ditemukan atau belum ada siswa aktif.' }]);
    if ('enrollmentIds' in input && (await activeEnrollments(tx, period.academicYearId, { ids })).length !== ids.length) throw new ValidationError([{ path: 'enrollmentIds', message: 'Ada siswa yang bukan siswa aktif tahun ajaran ujian ini.' }]);
    await lockRoom(tx, roomId);
    const plan = planSeating({ roomId, occupied: await occupiedSeatNos(tx, roomId), existing: await seatsInPeriod(tx, room.periodId, ids), enrollmentIds: ids });
    if (room.capacity !== null && plan.seatedAfter > room.capacity) throw new ConflictError(`Ruang ini hanya muat ${room.capacity} siswa.`, { reason: 'room_full' });
    // Someone who has arrived has sat their exam in this room: they are not moved afterwards.
    if ((await checkedInAmong(tx, room.periodId, plan.move.map((m) => m.enrollmentId))).length > 0) throw new ConflictError('Ada siswa yang sudah absen ujian di ruang lain dan tidak bisa dipindah.', { reason: 'checked_in' });
    // Movers first: freeing their old seats is not needed (numbers here are free ones), only the room changes.
    for (const m of plan.move) await moveSeat(tx, room.periodId, m.enrollmentId, roomId, m.seatNo);
    await insertSeats(tx, plan.add.map((a) => ({ schoolId: actor.schoolId, periodId: room.periodId, roomId, enrollmentId: a.enrollmentId, seatNo: a.seatNo })));
    await audit(tx, auditCtx, 'exam.students_seated', { type: 'exam_room', id: roomId }, { after: { room: room.name, added: plan.add.length, moved: plan.move.length } });
    return { added: plan.add.length, moved: plan.move.length, unchanged: plan.unchanged, seated: plan.seatedAfter };
  });
}

/** DELETE /exam/rooms/{id}/students/{enrollmentId} */
export function unseatStudent(actor: Actor, auditCtx: AuditContext, roomId: string, enrollmentId: string): Promise<void> {
  authorize(actor, canManageExams);
  return withTenant(scope(actor), async (tx) => {
    const room = await findRoom(tx, roomId);
    if (!room) throw new NotFoundError('Ruang tidak ditemukan.');
    if ((await checkedInAmong(tx, room.periodId, [enrollmentId])).length > 0) throw new ConflictError('Siswa ini sudah absen ujian di ruang ini.', { reason: 'checked_in' });
    if (!(await deleteSeat(tx, roomId, enrollmentId))) throw new NotFoundError('Siswa tidak duduk di ruang ini.');
    await audit(tx, auditCtx, 'exam.student_unseated', { type: 'exam_room', id: roomId }, { before: { room: room.name } });
  });
}

/** GET /exam/rooms/{id}/students: the seat list, for wakasek, kepsek, admin and the room's own pengawas. */
export function roomRoster(actor: Actor, roomId: string): Promise<RoomRoster> {
  return withTenant(scope(actor), async (tx) => {
    const room = await findRoom(tx, roomId);
    if (!room) throw new NotFoundError('Ruang tidak ditemukan.');
    if (!seesAllRooms.allows(actor) && room.supervisorId !== actor.userId) throw new ForbiddenError();
    const seats = await seatsOfRoom(tx, roomId);
    return { room: viewRoom(room), items: seats.map((x) => ({ enrollmentId: x.enrollmentId, seatNo: x.seatNo, student: { name: x.name }, className: x.className })) };
  });
}
