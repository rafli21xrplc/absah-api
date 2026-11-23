import { z } from 'zod';
import { TeacherLeaveKind } from './leave';

/** Who reads the monthly teacher attendance report (GRU-04): the kepsek, with the wakasek and admin. */
export const TEACHER_REPORT_READERS = ['kepsek', 'wakasek', 'admin'] as const;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Bulan harus YYYY-MM.');

/** GET /api/v1/teacher-attendance/report?month=YYYY-MM[&teacherId=]: default the current month; teacherId adds that teacher's day by day. */
export const TeacherReportQuery = z.object({ month: Month.optional(), teacherId: z.uuid().optional() }).meta({ id: 'TeacherReportQuery' });
export type TeacherReportQuery = z.infer<typeof TeacherReportQuery>;

export const TeacherDayStatus = z.enum(['present', 'late', ...TeacherLeaveKind.options, 'none']).meta({ id: 'TeacherDayStatus' });
export type TeacherDayStatus = z.infer<typeof TeacherDayStatus>;

export const TeacherReportRow = z
  .object({
    teacher: z.object({ id: z.uuid(), name: z.string() }),
    /** Days the teacher came (late ones included). */
    present: z.int(),
    /** Of those, the days they came after the school start. */
    late: z.int(),
    /** School days on approved izin, when they did not come. */
    leave: z.object({ sakit: z.int(), izin: z.int(), dinas: z.int() }),
    /** School days with neither a check-in nor an approved izin. */
    noRecord: z.int(),
    /** present / school days, in percent with one decimal; null when the month has no school day yet. */
    rate: z.number().nullable(),
    /** Sessions they took over from a teacher on izin this month. */
    substitutionsTaken: z.int(),
    /** Only when teacherId was asked for: every school day of the month so far. */
    days: z
      .array(z.object({ date: z.iso.date(), status: TeacherDayStatus, checkedInAt: z.iso.datetime().nullable(), checkedOutAt: z.iso.datetime().nullable() }))
      .optional(),
  })
  .meta({ id: 'TeacherReportRow' });
export type TeacherReportRow = z.infer<typeof TeacherReportRow>;

export const TeacherReport = z
  .object({
    month: Month,
    /** The school days counted: from the first of the month up to today, or the month's end. */
    schoolDays: z.int(),
    through: z.iso.date().nullable(),
    items: z.array(TeacherReportRow),
    totals: z.object({ present: z.int(), late: z.int(), leave: z.int(), noRecord: z.int(), rate: z.number().nullable() }),
  })
  .meta({ id: 'TeacherReport' });
export type TeacherReport = z.infer<typeof TeacherReport>;
