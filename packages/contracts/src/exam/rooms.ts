import { z } from 'zod';

/** UJN-03: rooms of an exam period and who sits where. The wakasek and admin arrange; kepsek reads; the room's pengawas reads their own room. */

export const ExamRoom = z
  .object({
    id: z.uuid(),
    name: z.string(),
    capacity: z.number().int().nullable(),
    supervisor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    seated: z.number().int(),
  })
  .meta({ id: 'ExamRoom' });
export type ExamRoom = z.infer<typeof ExamRoom>;

export const ExamRoomList = z
  .object({
    items: z.array(ExamRoom),
    /** Active students of the period's academic year with no room yet. */
    unseated: z.number().int(),
  })
  .meta({ id: 'ExamRoomList' });
export type ExamRoomList = z.infer<typeof ExamRoomList>;

export const CreateExamRoomRequest = z
  .object({
    name: z.string().trim().min(1, 'Nama ruang wajib diisi.').max(40),
    capacity: z.number().int().min(1).max(500).nullable().default(null),
    supervisorId: z.uuid().nullable().default(null),
  })
  .strict()
  .meta({ id: 'CreateExamRoomRequest' });
export type CreateExamRoomRequest = z.infer<typeof CreateExamRoomRequest>;

export const UpdateExamRoomRequest = z
  .object({
    name: z.string().trim().min(1, 'Nama ruang wajib diisi.').max(40).optional(),
    capacity: z.number().int().min(1).max(500).nullable().optional(),
    supervisorId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Tidak ada yang diubah.' })
  .meta({ id: 'UpdateExamRoomRequest' });
export type UpdateExamRoomRequest = z.infer<typeof UpdateExamRoomRequest>;

/** Seat a whole rombel, or named students. Someone already in another room of the period is moved. */
export const SeatStudentsRequest = z
  .union([z.object({ classId: z.uuid() }).strict(), z.object({ enrollmentIds: z.array(z.uuid()).min(1).max(500) }).strict()])
  .meta({ id: 'SeatStudentsRequest' });
export type SeatStudentsRequest = z.infer<typeof SeatStudentsRequest>;

export const SeatStudentsResult = z
  .object({ added: z.number().int(), moved: z.number().int(), unchanged: z.number().int(), seated: z.number().int() })
  .meta({ id: 'SeatStudentsResult' });
export type SeatStudentsResult = z.infer<typeof SeatStudentsResult>;

export const RoomRoster = z
  .object({
    room: ExamRoom,
    items: z.array(z.object({ enrollmentId: z.uuid(), seatNo: z.number().int(), student: z.object({ name: z.string() }), className: z.string() })),
  })
  .meta({ id: 'RoomRoster' });
export type RoomRoster = z.infer<typeof RoomRoster>;

export const ExamRoomIdParam = z.object({ roomId: z.uuid() });
export const ExamRoomSeatParam = z.object({ roomId: z.uuid(), enrollmentId: z.uuid() });

/** The rooms the caller supervises in exams still ahead or on today: how a pengawas finds their room (UJN-03). */
export const MyRooms = z
  .object({ items: z.array(z.object({ room: ExamRoom, period: z.object({ id: z.uuid(), name: z.string(), startsOn: z.string(), endsOn: z.string() }) })) })
  .meta({ id: 'MyRooms' });
export type MyRooms = z.infer<typeof MyRooms>;
