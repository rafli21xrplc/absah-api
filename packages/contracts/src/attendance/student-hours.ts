import { z } from 'zod';
import { AttendanceStatus, SessionMode, SessionOwnerType, SessionStatus } from './enums';

/**
 * AKD-10: every lesson of a rombel's students on one day, including learning group lessons shared
 * with other rombel, so the wali kelas sees each student's whole day. Activity sessions are not here.
 */
export const ClassStudentHoursParams = z.object({ classId: z.uuid() });
export const ClassStudentHoursQuery = z.object({ date: z.iso.date().optional() }).meta({ id: 'ClassStudentHoursQuery' });
export type ClassStudentHoursQuery = z.infer<typeof ClassStudentHoursQuery>;

const Ref = z.object({ id: z.uuid(), name: z.string() });

export const ClassStudentHours = z
  .object({
    classId: z.uuid(),
    className: z.string(),
    schoolDate: z.iso.date(),
    /** The rombel's own sessions and those of learning groups any of its students are in, by time. */
    sessions: z.array(
      z.object({
        id: z.uuid(),
        mode: SessionMode,
        status: SessionStatus,
        owner: z.object({ type: SessionOwnerType, id: z.uuid(), name: z.string() }),
        period: z.object({ number: z.int(), startsAt: z.string(), endsAt: z.string() }).nullable(),
        subject: Ref.nullable(),
        teacher: Ref.nullable(),
      }),
    ),
    students: z.array(
      z.object({
        enrollmentId: z.uuid(),
        studentId: z.uuid(),
        name: z.string(),
        /** The day's status (daily_attendance), null until any session of the day is recorded. */
        daily: AttendanceStatus.nullable(),
        /** One entry per session the student belongs to; status null = not recorded yet. */
        sessions: z.array(z.object({ sessionId: z.uuid(), status: AttendanceStatus.nullable() })),
      }),
    ),
  })
  .meta({ id: 'ClassStudentHours' });
export type ClassStudentHours = z.infer<typeof ClassStudentHours>;
