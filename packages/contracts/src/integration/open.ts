import { z } from 'zod';
import { AttendanceStatus } from '../attendance/enums';

/**
 * The open API (PLT-09), path prefix /api/v1/open, `Authorization: Bearer <api key>`. It never carries a name, NISN or phone
 * number: only opaque ids and statuses. Every answer is the school of the key and nothing else.
 */

/** How far back the daily attendance can be asked for. */
export const OPEN_ATTENDANCE_MAX_DAYS_BACK = 366;

export const OpenDailyAttendanceQuery = z
  .object({
    /** School date; default today in the school's timezone. Not in the future, at most OPEN_ATTENDANCE_MAX_DAYS_BACK days back. */
    date: z.iso.date().optional(),
    /** Only this rombel. */
    classId: z.uuid().optional(),
  })
  .meta({ id: 'OpenDailyAttendanceQuery' });
export type OpenDailyAttendanceQuery = z.infer<typeof OpenDailyAttendanceQuery>;

export const OpenDailyAttendance = z
  .object({
    date: z.iso.date(),
    /** One row per enrollment that has a recorded status that day. */
    items: z.array(z.object({ enrollmentId: z.uuid(), classId: z.uuid(), status: AttendanceStatus })),
  })
  .meta({ id: 'OpenDailyAttendance' });
export type OpenDailyAttendance = z.infer<typeof OpenDailyAttendance>;
