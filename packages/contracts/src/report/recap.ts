import { z } from 'zod';
import { ClassStream } from '../academic/enums';
import { AttendanceStatus } from '../attendance/enums';

/** Rekap (RKP-01, RKP-02, RKP-04). All counts are school days from daily_attendance. */

/** Longest period one rekap request covers (a school year plus slack). */
export const RECAP_MAX_DAYS = 366;

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** ?from=&to= (school dates, inclusive). One day = rekap harian; a semester's dates = rekap semester. */
export const ReportPeriodQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to, { message: 'Tanggal akhir sebelum tanggal awal.', path: ['to'] })
  .refine((q) => daysBetween(q.from, q.to) < RECAP_MAX_DAYS, { message: 'Rentang paling lama satu tahun.', path: ['to'] })
  .meta({ id: 'ReportPeriodQuery' });
export type ReportPeriodQuery = z.infer<typeof ReportPeriodQuery>;

/** Days per status (H, T, S, I, A); a student without a rekap row that day is not counted. */
export const AttendanceCounts = z.record(AttendanceStatus, z.int().nonnegative()).meta({ id: 'AttendanceCounts' });
export type AttendanceCounts = z.infer<typeof AttendanceCounts>;

const Person = z.object({ id: z.uuid(), name: z.string() });

const RecapTotals = z.object({
  counts: AttendanceCounts,
  /** Student-days with a rekap status (the sum of counts). */
  days: z.int().nonnegative(),
  /** (H + T) / days, 0..1; null without any day. */
  presentRate: z.number().min(0).max(1).nullable(),
});

/** GET /api/v1/reports/semesters: semesters of the active year, for the period picker. */
export const ReportSemesterList = z
  .object({
    items: z.array(
      z.object({
        id: z.uuid(),
        academicYear: z.string(),
        number: z.int().min(1).max(2),
        startsOn: z.iso.date(),
        endsOn: z.iso.date(),
      }),
    ),
  })
  .meta({ id: 'ReportSemesterList' });
export type ReportSemesterList = z.infer<typeof ReportSemesterList>;

/** GET /api/v1/reports/attendance/classes: one row per rombel the caller may see (active year). */
export const ClassRecapList = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    items: z.array(
      RecapTotals.extend({
        id: z.uuid(),
        name: z.string(),
        grade: z.int(),
        /** Jurusan (AKD-11), null for rombel without one. */
        stream: ClassStream.nullable(),
        homeroom: Person.nullable(),
        /** Students enrolled in the rombel at some point of the period. */
        students: z.int().nonnegative(),
      }),
    ),
  })
  .meta({ id: 'ClassRecapList' });
export type ClassRecapList = z.infer<typeof ClassRecapList>;

/** ?stream= on GET /reports/attendance/classes: only rombel of one jurusan (AKD-11). */
export const RecapStreamQuery = z.object({ stream: ClassStream.optional() }).meta({ id: 'RecapStreamQuery' });
export type RecapStreamQuery = z.infer<typeof RecapStreamQuery>;

export const RecapClassIdParam = z.object({ classId: z.uuid() });

/**
 * GET /api/v1/reports/attendance/classes/{classId}: one row per enrollment of the rombel that overlaps
 * the period. A student who moved rombel appears in each rombel with the days spent there.
 */
export const ClassRecapDetail = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    class: z.object({ id: z.uuid(), name: z.string(), grade: z.int(), homeroom: Person.nullable() }),
    items: z.array(
      RecapTotals.extend({
        enrollmentId: z.uuid(),
        studentId: z.uuid(),
        name: z.string(),
        nisn: z.string().nullable(),
        localId: z.string().nullable(),
        /** False when the student left or moved before the end of the period. */
        active: z.boolean(),
      }),
    ),
    totals: RecapTotals,
  })
  .meta({ id: 'ClassRecapDetail' });
export type ClassRecapDetail = z.infer<typeof ClassRecapDetail>;

const ComplianceCounts = z.object({
  sessions: z.int().nonnegative(),
  /** Filled by the teacher (status submitted or locked after submission). */
  filled: z.int().nonnegative(),
  /** Filled only after the "belum diisi" reminder went out. */
  filledLate: z.int().nonnegative(),
  /** Never filled before the day was locked. */
  missed: z.int().nonnegative(),
  /** Still open (today, not locked yet). */
  open: z.int().nonnegative(),
  /** filled / (sessions - open), 0..1; null when nothing is due yet. */
  fillRate: z.number().min(0).max(1).nullable(),
});

/** GET /api/v1/reports/session-compliance (RKP-04, wakasek): class and daily sessions in the period. */
export const SessionCompliance = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    totals: ComplianceCounts,
    /** Worst fill rate first; teacher null = sessions without a teacher (no one assigned). */
    teachers: z.array(ComplianceCounts.extend({ teacher: Person.nullable() })),
    days: z.array(ComplianceCounts.extend({ date: z.iso.date() })),
  })
  .meta({ id: 'SessionCompliance' });
export type SessionCompliance = z.infer<typeof SessionCompliance>;
