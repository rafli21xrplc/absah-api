import { z } from 'zod';

/** UKS (KSW-08, behind student.uks): the petugas_uks records visits; "dipulangkan" marks the rest of the day S. */

export const UKS_OUTCOMES = ['kembali_kelas', 'istirahat', 'dipulangkan'] as const;
export const UksOutcome = z.enum(UKS_OUTCOMES).meta({ id: 'UksOutcome' });
export type UksOutcome = z.infer<typeof UksOutcome>;

/** POST /api/v1/uks/visits. The notes are encrypted at rest and never leave this module's endpoints. */
export const CreateUksVisitRequest = z
  .object({
    enrollmentId: z.uuid(),
    complaint: z.string().trim().min(2, 'Tulis keluhan siswa.').max(500),
    action: z.string().trim().max(500).optional(),
    outcome: UksOutcome,
  })
  .strict()
  .meta({ id: 'CreateUksVisitRequest' });
export type CreateUksVisitRequest = z.infer<typeof CreateUksVisitRequest>;

const Student = z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() });

export const UksVisit = z
  .object({
    id: z.uuid(),
    schoolDate: z.iso.date(),
    visitedAt: z.iso.datetime({ offset: true }),
    student: Student,
    complaint: z.string(),
    action: z.string().nullable(),
    outcome: UksOutcome,
    recordedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  })
  .meta({ id: 'UksVisit' });
export type UksVisit = z.infer<typeof UksVisit>;

/** GET /api/v1/uks/visits?date=: the day's visits (default today), newest first. */
export const UksVisitsQuery = z.object({ date: z.iso.date().optional() }).meta({ id: 'UksVisitsQuery' });
export type UksVisitsQuery = z.infer<typeof UksVisitsQuery>;

export const UksVisitList = z.object({ schoolDate: z.iso.date(), items: z.array(UksVisit) }).meta({ id: 'UksVisitList' });
export type UksVisitList = z.infer<typeof UksVisitList>;

/** GET /api/v1/uks/students?q=: active students by name, at most 20, to pick who came. */
export const UksStudentQuery = z.object({ q: z.string().trim().min(2, 'Ketik minimal 2 huruf.').max(60) }).meta({ id: 'UksStudentQuery' });
export type UksStudentQuery = z.infer<typeof UksStudentQuery>;

export const UksStudentList = z.object({ items: z.array(Student) }).meta({ id: 'UksStudentList' });
export type UksStudentList = z.infer<typeof UksStudentList>;
