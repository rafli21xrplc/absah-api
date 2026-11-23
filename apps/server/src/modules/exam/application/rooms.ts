import type { CreateExamRoomRequest, ExamRoom, ExamRoomList, UpdateExamRoomRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManageExams, canReadExams } from '../domain/policies';
import { roomHasCheckIns } from '../infrastructure/attendance-repo';
import { findPeriod } from '../infrastructure/period-repo';
import { deleteRoom, findRoom, insertRoom, isStaffMember, listRooms, unseatedCount, updateRoom, type RoomRow } from '../infrastructure/room-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NAME_KEY = 'exam_rooms_period_name_key';
const NAME_TAKEN = 'Nama ruang sudah dipakai pada ujian ini.';
/** The audit sanitiser redacts any key called "name"; a room's name is not personal data. */
const forAudit = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === 'name' ? 'room' : k, v]));

export function viewRoom(row: RoomRow): ExamRoom {
  return { id: row.id, name: row.name, capacity: row.capacity, supervisor: row.supervisorId ? { id: row.supervisorId, name: row.supervisorName ?? '' } : null, seated: row.seated };
}

async function checkSupervisor(tx: Parameters<typeof isStaffMember>[0], supervisorId: string | null | undefined) {
  if (supervisorId && !(await isStaffMember(tx, supervisorId))) throw new ValidationError([{ path: 'supervisorId', message: 'Pengawas harus anggota staf sekolah.' }]);
}

/** GET /exam/periods/{id}/rooms */
export function listExamRooms(actor: Actor, periodId: string): Promise<ExamRoomList> {
  authorize(actor, canReadExams);
  return withTenant(scope(actor), async (tx) => {
    const period = await findPeriod(tx, periodId);
    if (!period) throw new NotFoundError('Ujian tidak ditemukan.');
    return { items: (await listRooms(tx, periodId)).map(viewRoom), unseated: await unseatedCount(tx, period.academicYearId, periodId) };
  });
}

export function createExamRoom(actor: Actor, auditCtx: AuditContext, periodId: string, input: CreateExamRoomRequest): Promise<ExamRoom> {
  authorize(actor, canManageExams);
  return withTenant(scope(actor), async (tx) => {
    const period = await findPeriod(tx, periodId);
    if (!period) throw new NotFoundError('Ujian tidak ditemukan.');
    if (period.closedAt) throw new ConflictError('Ujian sudah ditutup.', { reason: 'period_closed' });
    await checkSupervisor(tx, input.supervisorId);
    const id = uuidv7();
    try {
      await insertRoom(tx, { id, schoolId: actor.schoolId, periodId, ...input });
    } catch (err) {
      if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN, { reason: 'name_taken' });
      throw err;
    }
    await audit(tx, auditCtx, 'exam.room_created', { type: 'exam_room', id }, { after: forAudit({ name: input.name, capacity: input.capacity, supervisorId: input.supervisorId }) });
    const row = await findRoom(tx, id);
    if (!row) throw new Error('exam room vanished');
    return viewRoom(row);
  });
}

export function updateExamRoom(actor: Actor, auditCtx: AuditContext, roomId: string, input: UpdateExamRoomRequest): Promise<ExamRoom> {
  authorize(actor, canManageExams);
  return withTenant(scope(actor), async (tx) => {
    const before = await findRoom(tx, roomId);
    if (!before) throw new NotFoundError('Ruang tidak ditemukan.');
    const changed = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as UpdateExamRoomRequest;
    await checkSupervisor(tx, changed.supervisorId);
    // A smaller capacity than the students already seated would leave the room over full.
    if (typeof changed.capacity === 'number' && changed.capacity < before.seated) throw new ConflictError('Kapasitas lebih kecil dari jumlah siswa yang sudah duduk di ruang ini.', { reason: 'room_full' });
    try {
      await updateRoom(tx, roomId, changed);
    } catch (err) {
      if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN, { reason: 'name_taken' });
      throw err;
    }
    await audit(tx, auditCtx, 'exam.room_updated', { type: 'exam_room', id: roomId }, { before: forAudit(Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]]))), after: forAudit(changed) });
    const row = await findRoom(tx, roomId);
    if (!row) throw new Error('exam room vanished');
    return viewRoom(row);
  });
}

/** DELETE /exam/rooms/{id}: the room and its seating; refused once anyone has been checked in there (409 room_has_attendance). */
export function removeExamRoom(actor: Actor, auditCtx: AuditContext, roomId: string): Promise<void> {
  authorize(actor, canManageExams);
  return withTenant(scope(actor), async (tx) => {
    const room = await findRoom(tx, roomId);
    if (!room) throw new NotFoundError('Ruang tidak ditemukan.');
    if (await roomHasCheckIns(tx, roomId)) throw new ConflictError('Ruang ini sudah dipakai untuk absen ujian dan tidak bisa dihapus.', { reason: 'room_has_attendance' });
    await deleteRoom(tx, roomId);
    await audit(tx, auditCtx, 'exam.room_removed', { type: 'exam_room', id: roomId }, { before: forAudit({ name: room.name, seated: room.seated }) });
  });
}
