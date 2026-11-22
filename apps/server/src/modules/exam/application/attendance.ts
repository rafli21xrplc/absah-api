import type { ExamCheckIn, ExamCheckInRequest, ExamScanRequest, RoomAttendance } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { anyRole, type Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { findSchool } from '../../attendance';
import { verifyCardQr } from '../../gate';
import { checkInsOfRoom, findCheckIn, insertCheckIn, roomNameOf, seatInRoom, seatOfStudent, type CheckInRow } from '../infrastructure/attendance-repo';
import { findPeriod } from '../infrastructure/period-repo';
import { findRoom, seatsOfRoom, type RoomRow } from '../infrastructure/room-repo';
import { evaluateStudents } from './eligibility';
import { viewRoom } from './rooms';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
type Tx = Parameters<typeof findRoom>[0];
type Period = NonNullable<Awaited<ReturnType<typeof findPeriod>>>;

const managers = anyRole('wakasek', 'admin');
const seesAllRooms = anyRole('wakasek', 'kepsek', 'admin');

/** Checking in is for the wakasek, the admin, or the room's own pengawas. */
function mayRecord(actor: Actor, room: RoomRow) {
  if (!managers.allows(actor) && room.supervisorId !== actor.userId) throw new ForbiddenError();
}

async function load(tx: Tx, actor: Actor, roomId: string) {
  const room = await findRoom(tx, roomId);
  if (!room) throw new NotFoundError('Ruang tidak ditemukan.');
  const period = await findPeriod(tx, room.periodId);
  if (!period) throw new NotFoundError('Ujian tidak ditemukan.');
  const timezone = (await findSchool(tx, actor.schoolId))?.timezone ?? 'Asia/Jakarta';
  return { room, period, timezone };
}

const view = (row: CheckInRow, seatNo: number, name: string, duplicate: boolean): ExamCheckIn => ({
  enrollmentId: row.enrollmentId,
  student: { name },
  seatNo,
  checkedInAt: row.checkedInAt.toISOString(),
  method: row.method as ExamCheckIn['method'],
  duplicate,
});

/** The student sits somewhere else (or nowhere): the pengawas is told where to send them. */
async function notHere(tx: Tx, period: Period, enrollmentId: string): Promise<never> {
  const elsewhere = await roomNameOf(tx, period.id, enrollmentId);
  if (elsewhere) throw new ConflictError(`Siswa ini duduk di ruang ${elsewhere}.`, { reason: 'wrong_room', room: elsewhere });
  throw new ConflictError('Siswa ini belum punya tempat di ruang mana pun untuk ujian ini.', { reason: 'not_seated' });
}

/**
 * The one way in: the exam must be open and on today's date, the student seated in this very room, and allowed to sit by
 * the period's rule right now. Once per period; a second try answers with the first arrival and records nothing.
 */
async function checkIn(tx: Tx, actor: Actor, auditCtx: AuditContext, ctx: { room: RoomRow; period: Period; timezone: string }, enrollmentId: string, method: 'qr' | 'manual', now: Date): Promise<{ result: ExamCheckIn; created: boolean }> {
  const { room, period, timezone } = ctx;
  if (period.closedAt) throw new ConflictError('Ujian sudah ditutup.', { reason: 'period_closed' });
  const today = schoolDate(timezone, now);
  if (today < period.startsOn || today > period.endsOn) throw new ConflictError('Hari ini bukan hari ujian ini.', { reason: 'not_exam_day' });
  const seat = await seatInRoom(tx, room.id, enrollmentId);
  if (!seat) return notHere(tx, period, enrollmentId);
  const [verdict] = await evaluateStudents(tx, period, [{ enrollmentId }], today);
  if (!verdict?.eligible) throw new ConflictError('Siswa ini belum boleh ujian.', { reason: 'not_eligible', reasons: (verdict?.reasons ?? []).map((r) => r.kind) });
  const row = await insertCheckIn(tx, { schoolId: actor.schoolId, periodId: period.id, roomId: room.id, enrollmentId, checkedInAt: now, method, recordedBy: actor.userId });
  if (!row) {
    const earlier = await findCheckIn(tx, period.id, enrollmentId);
    if (!earlier) throw new Error('exam check-in vanished');
    return { result: view(earlier, seat.seatNo, seat.name, true), created: false };
  }
  await audit(tx, auditCtx, 'exam.checked_in', { type: 'exam_room', id: room.id }, { after: { period: period.name, room: room.name, method } });
  return { result: view(row, seat.seatNo, seat.name, false), created: true };
}

/** POST /exam/rooms/{id}/attendance: the pengawas ticks a student by hand (the phone did not scan, the card is lost). */
export function checkInManually(actor: Actor, auditCtx: AuditContext, roomId: string, input: ExamCheckInRequest, now = new Date()) {
  return withTenant(scope(actor), async (tx) => {
    const ctx = await load(tx, actor, roomId);
    mayRecord(actor, ctx.room);
    return checkIn(tx, actor, auditCtx, ctx, input.enrollmentId, 'manual', now);
  });
}

/**
 * POST /exam/rooms/{id}/scan: the pengawas scans the student's card QR, the same dynamic QR as the daily card (signature,
 * 30-second window and the card's bound phone are checked exactly as at the gate). A card that does not check out is
 * 409 card_rejected with the reason; the rest is as for a manual check-in.
 */
export function checkInByCard(actor: Actor, auditCtx: AuditContext, roomId: string, input: ExamScanRequest, now = new Date()) {
  return withTenant(scope(actor), async (tx) => {
    const ctx = await load(tx, actor, roomId);
    mayRecord(actor, ctx.room);
    const card = await verifyCardQr(tx, actor.schoolId, input.token, now.getTime(), ctx.timezone);
    if (!card.ok) throw new ConflictError('Kartu tidak dikenali atau sudah kedaluwarsa.', { reason: 'card_rejected', cardReason: card.reason });
    const seat = await seatOfStudent(tx, ctx.period.id, card.studentId);
    if (!seat) throw new ConflictError('Siswa ini belum punya tempat di ruang mana pun untuk ujian ini.', { reason: 'not_seated' });
    if (seat.roomId !== ctx.room.id) throw new ConflictError(`Siswa ini duduk di ruang ${seat.roomName}.`, { reason: 'wrong_room', room: seat.roomName });
    return checkIn(tx, actor, auditCtx, ctx, seat.enrollmentId, 'qr', now);
  });
}

/** GET /exam/rooms/{id}/attendance: the seat list with who has arrived, for wakasek, kepsek, admin and the room's own pengawas. */
export function roomAttendance(actor: Actor, roomId: string, now = new Date()): Promise<RoomAttendance> {
  return withTenant(scope(actor), async (tx) => {
    const { room, period, timezone } = await load(tx, actor, roomId);
    if (!seesAllRooms.allows(actor) && room.supervisorId !== actor.userId) throw new ForbiddenError();
    const seats = await seatsOfRoom(tx, roomId);
    const arrived = await checkInsOfRoom(tx, roomId);
    const verdicts = new Map((await evaluateStudents(tx, period, seats, schoolDate(timezone, now))).map((v) => [v.s.enrollmentId, v.eligible]));
    const items = seats.map((x) => {
      const here = arrived.get(x.enrollmentId);
      return {
        enrollmentId: x.enrollmentId,
        seatNo: x.seatNo,
        student: { name: x.name },
        className: x.className,
        present: here !== undefined,
        checkedInAt: here ? here.checkedInAt.toISOString() : null,
        method: (here?.method ?? null) as 'qr' | 'manual' | null,
        eligible: verdicts.get(x.enrollmentId) ?? false,
      };
    });
    const present = items.filter((i) => i.present).length;
    return { room: viewRoom(room), counts: { seated: items.length, present, absent: items.length - present }, items };
  });
}
