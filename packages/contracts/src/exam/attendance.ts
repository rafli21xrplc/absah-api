import { z } from 'zod';
import { ExamRoom } from './rooms';

/** UJN-03: who arrived to sit the exam, per room. The pengawas of the room (or wakasek/admin) records; the card QR is the daily one. */

export const EXAM_CHECKIN_METHODS = ['qr', 'manual'] as const;

export const ExamCheckInRequest = z.object({ enrollmentId: z.uuid() }).strict().meta({ id: 'ExamCheckInRequest' });
export type ExamCheckInRequest = z.infer<typeof ExamCheckInRequest>;

/** The text a card screen shows (the same dynamic QR as the daily card), as read by the pengawas' scanner. */
export const ExamScanRequest = z.object({ token: z.string().min(1).max(200) }).strict().meta({ id: 'ExamScanRequest' });
export type ExamScanRequest = z.infer<typeof ExamScanRequest>;

export const ExamCheckIn = z
  .object({
    enrollmentId: z.uuid(),
    student: z.object({ name: z.string() }),
    seatNo: z.number().int(),
    checkedInAt: z.iso.datetime({ offset: true }),
    method: z.enum(EXAM_CHECKIN_METHODS),
    /** true when the student had already been checked in: nothing was recorded again. */
    duplicate: z.boolean(),
  })
  .meta({ id: 'ExamCheckIn' });
export type ExamCheckIn = z.infer<typeof ExamCheckIn>;

export const RoomAttendance = z
  .object({
    room: ExamRoom,
    counts: z.object({ seated: z.number().int(), present: z.number().int(), absent: z.number().int() }),
    items: z.array(
      z.object({
        enrollmentId: z.uuid(),
        seatNo: z.number().int(),
        student: z.object({ name: z.string() }),
        className: z.string(),
        present: z.boolean(),
        checkedInAt: z.iso.datetime({ offset: true }).nullable(),
        method: z.enum(EXAM_CHECKIN_METHODS).nullable(),
        /** Whether the student may sit right now (the period's rule); someone who may not is turned away at check-in. */
        eligible: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'RoomAttendance' });
export type RoomAttendance = z.infer<typeof RoomAttendance>;
