import { z } from 'zod';
import { SchoolDay, SlotOwnerType } from './enums';

/** Subjects, jam pelajaran, timetable slots and homeroom teachers (AKD-05). */

export const Subject = z.object({ id: z.uuid(), name: z.string(), code: z.string().nullable() }).meta({ id: 'Subject' });
export const SubjectList = z.object({ items: z.array(Subject) }).meta({ id: 'SubjectList' });
export const CreateSubjectRequest = z
  .object({
    name: z.string().trim().min(2, 'Nama mapel minimal 2 huruf.').max(80),
    code: z.string().trim().max(20).optional(),
  })
  .strict()
  .meta({ id: 'CreateSubjectRequest' });
export type CreateSubjectRequest = z.infer<typeof CreateSubjectRequest>;

/** HH:MM, 24-hour, school time zone. */
export const LessonTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM.');

export const SchedulePeriod = z.object({ number: z.int().min(0).max(20), startsAt: LessonTime, endsAt: LessonTime });
export const ScheduleDayPeriods = z.object({ day: SchoolDay, periods: z.array(SchedulePeriod).max(20) });

/** GET and PUT /api/v1/schedule/periods. PUT replaces every day; a day left out has no lessons. */
export const SchedulePeriodsResponse = z.object({ days: z.array(ScheduleDayPeriods) }).meta({ id: 'SchedulePeriodsResponse' });
export type SchedulePeriodsResponse = z.infer<typeof SchedulePeriodsResponse>;
export const ReplaceSchedulePeriodsRequest = z
  .object({ days: z.array(ScheduleDayPeriods).max(7) })
  .strict()
  .meta({ id: 'ReplaceSchedulePeriodsRequest' });
export type ReplaceSchedulePeriodsRequest = z.infer<typeof ReplaceSchedulePeriodsRequest>;

export const StaffRef = z.object({ id: z.uuid(), name: z.string() });
export const TeacherList = z.object({ items: z.array(StaffRef) }).meta({ id: 'TeacherList' });

/** GET /api/v1/schedule: exactly one of classId, groupId, teacherId. */
export const ScheduleQuery = z
  .object({ classId: z.uuid().optional(), groupId: z.uuid().optional(), teacherId: z.uuid().optional() })
  .refine((q) => [q.classId, q.groupId, q.teacherId].filter(Boolean).length === 1, { message: 'Pilih satu rombel, kelompok, atau guru.' })
  .meta({ id: 'ScheduleQuery' });
export type ScheduleQuery = z.infer<typeof ScheduleQuery>;

export const ScheduleSlot = z
  .object({
    id: z.uuid(),
    ownerType: SlotOwnerType,
    ownerId: z.uuid(),
    ownerName: z.string(),
    day: SchoolDay,
    period: z.int(),
    subject: z.object({ id: z.uuid(), name: z.string() }),
    teacher: StaffRef.nullable(),
  })
  .meta({ id: 'ScheduleSlot' });
export type ScheduleSlot = z.infer<typeof ScheduleSlot>;

export const ScheduleResponse = z
  .object({ academicYear: z.object({ id: z.uuid(), name: z.string() }).nullable(), slots: z.array(ScheduleSlot) })
  .meta({ id: 'ScheduleResponse' });
export type ScheduleResponse = z.infer<typeof ScheduleResponse>;

/** PUT /api/v1/schedule/slots: sets the lesson of a rombel/group at (day, period), replacing it. */
export const PutScheduleSlotRequest = z
  .object({
    ownerType: SlotOwnerType,
    ownerId: z.uuid(),
    day: SchoolDay,
    period: z.int().min(0).max(20),
    subjectId: z.uuid(),
    teacherId: z.uuid().nullable(),
  })
  .strict()
  .meta({ id: 'PutScheduleSlotRequest' });
export type PutScheduleSlotRequest = z.infer<typeof PutScheduleSlotRequest>;

export const SlotIdParam = z.object({ slotId: z.uuid() });

/** details.conflicts of a 409 SCHEDULE_CONFLICT. Student names are capped at 5. */
export const ScheduleConflictDetail = z
  .object({
    kind: z.enum(['owner', 'teacher', 'student']),
    day: SchoolDay,
    period: z.int(),
    /** The other slot's rombel or group. */
    with: z.string(),
    teacher: z.string().nullable(),
    studentCount: z.int(),
    students: z.array(z.string()),
  })
  .meta({ id: 'ScheduleConflictDetail' });
export type ScheduleConflictDetail = z.infer<typeof ScheduleConflictDetail>;

export const ClassIdParam = z.object({ classId: z.uuid() });
/** PATCH /api/v1/classes/{classId}: homeroom teacher (wali kelas); null removes it. */
export const UpdateClassRequest = z
  .object({ homeroomTeacherId: z.uuid().nullable() })
  .strict()
  .meta({ id: 'UpdateClassRequest' });
export type UpdateClassRequest = z.infer<typeof UpdateClassRequest>;
