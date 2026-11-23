import { z } from 'zod';
import type { Role } from '../platform/roles';

/** UJN: the wakasek (and admin) set up exam periods and their rule; kepsek reads; the wali kelas sees their own rombel. */
export const EXAM_MANAGERS = ['wakasek', 'admin'] as const satisfies readonly Role[];
export const EXAM_VIEWERS = ['wakasek', 'kepsek', 'admin', 'wali_kelas'] as const satisfies readonly Role[];

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD.');

export const ExamPeriod = z
  .object({
    id: z.uuid(),
    name: z.string(),
    academicYear: z.object({ id: z.uuid(), name: z.string() }),
    startsOn: z.string(),
    endsOn: z.string(),
    /** Percent of the days with a record that a student must have been present; null = no attendance rule. */
    minAttendance: z.number().int().nullable(),
    /** First day counted for attendance; null = the first day of the academic year. */
    attendanceFrom: z.string().nullable(),
    /** Sakit and izin count as present for the attendance rule; alpa never does. */
    excusedCounts: z.boolean(),
    /** Installments due on or before the first exam day must be paid (of feeTypeIds, or of every fee type when empty). */
    requirePaid: z.boolean(),
    feeTypeIds: z.array(z.uuid()),
    closed: z.boolean(),
  })
  .meta({ id: 'ExamPeriod' });
export type ExamPeriod = z.infer<typeof ExamPeriod>;

export const ExamPeriodList = z.object({ items: z.array(ExamPeriod) }).meta({ id: 'ExamPeriodList' });
export type ExamPeriodList = z.infer<typeof ExamPeriodList>;

const Rules = {
  minAttendance: z.number().int().min(1, 'Minimal 1 persen.').max(100, 'Maksimal 100 persen.').nullable(),
  attendanceFrom: IsoDate.nullable(),
  excusedCounts: z.boolean(),
  requirePaid: z.boolean(),
  feeTypeIds: z.array(z.uuid()).max(20),
};

export const CreateExamPeriodRequest = z
  .object({
    name: z.string().trim().min(2, 'Nama ujian minimal 2 huruf.').max(80),
    startsOn: IsoDate,
    endsOn: IsoDate,
    minAttendance: Rules.minAttendance.default(null),
    attendanceFrom: Rules.attendanceFrom.default(null),
    excusedCounts: Rules.excusedCounts.default(true),
    requirePaid: Rules.requirePaid.default(false),
    feeTypeIds: Rules.feeTypeIds.default([]),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'Tanggal selesai sebelum tanggal mulai.', path: ['endsOn'] })
  .meta({ id: 'CreateExamPeriodRequest' });
export type CreateExamPeriodRequest = z.infer<typeof CreateExamPeriodRequest>;

export const UpdateExamPeriodRequest = z
  .object({
    name: z.string().trim().min(2, 'Nama ujian minimal 2 huruf.').max(80).optional(),
    startsOn: IsoDate.optional(),
    endsOn: IsoDate.optional(),
    minAttendance: Rules.minAttendance.optional(),
    attendanceFrom: Rules.attendanceFrom.optional(),
    excusedCounts: Rules.excusedCounts.optional(),
    requirePaid: Rules.requirePaid.optional(),
    feeTypeIds: Rules.feeTypeIds.optional(),
    /** true closes the period, false opens it again. */
    closed: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Tidak ada yang diubah.' })
  .meta({ id: 'UpdateExamPeriodRequest' });
export type UpdateExamPeriodRequest = z.infer<typeof UpdateExamPeriodRequest>;

export const ExamPeriodIdParam = z.object({ periodId: z.uuid() });
export const ExamPeriodsQuery = z.object({ includeClosed: z.stringbool().default(false) });
export type ExamPeriodsQuery = z.infer<typeof ExamPeriodsQuery>;
