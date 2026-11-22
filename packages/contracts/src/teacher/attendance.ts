import { z } from 'zod';
import { TEACHER_ATTENDANCE_SOURCES } from './constants';

/** Teachers who check in with the staff app (GRU-01). Leaders who do not teach, and admin, do not. */
export const TEACHER_CHECKIN_ROLES = ['guru', 'wali_kelas', 'wakasek', 'piket', 'guru_bk', 'guru_tahfidz'] as const;

export const TeacherAttendance = z
  .object({
    schoolDate: z.iso.date(),
    checkedInAt: z.iso.datetime(),
    checkedOutAt: z.iso.datetime().nullable(),
    /** After the school start of that weekday (the first jam pelajaran, 07.00 without a timetable). */
    late: z.boolean(),
    source: z.enum(TEACHER_ATTENDANCE_SOURCES),
  })
  .meta({ id: 'TeacherAttendance' });
export type TeacherAttendance = z.infer<typeof TeacherAttendance>;

/** GET /api/v1/teacher-attendance/today: the caller's own day. */
export const TeacherToday = z
  .object({
    schoolDate: z.iso.date(),
    /** False on a holiday or a weekday without jam pelajaran: there is nothing to check in for. */
    schoolDay: z.boolean(),
    /** The school start the check-in is compared with, "HH:MM". */
    schoolStart: z.string(),
    attendance: TeacherAttendance.nullable(),
  })
  .meta({ id: 'TeacherToday' });
export type TeacherToday = z.infer<typeof TeacherToday>;
