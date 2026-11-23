import { z } from 'zod';
import { AttendanceStatus, CorrectionStatus } from './enums';

/** Corrections to locked sessions, decided by wakasek or kepsek (PRS-05). */

const Ref = z.object({ id: z.uuid(), name: z.string() });

/** POST /api/v1/sessions/{sessionId}/corrections: one request per changed student. */
export const CreateCorrectionsRequest = z
  .object({
    changes: z.array(z.object({ enrollmentId: z.uuid(), status: AttendanceStatus })).min(1).max(50),
    reason: z.string().trim().min(5, 'Tulis alasan koreksi.').max(300),
  })
  .strict()
  .meta({ id: 'CreateCorrectionsRequest' });
export type CreateCorrectionsRequest = z.infer<typeof CreateCorrectionsRequest>;

export const Correction = z
  .object({
    id: z.uuid(),
    session: z.object({ id: z.uuid(), schoolDate: z.iso.date(), ownerName: z.string(), subject: z.string().nullable(), period: z.int().nullable() }),
    student: z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    fromStatus: AttendanceStatus.nullable(),
    toStatus: AttendanceStatus,
    reason: z.string(),
    status: CorrectionStatus,
    requestedBy: Ref.nullable(),
    decidedBy: Ref.nullable(),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
    decisionNote: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Correction' });
export type Correction = z.infer<typeof Correction>;

export const CorrectionList = z.object({ items: z.array(Correction) }).meta({ id: 'CorrectionList' });
export type CorrectionList = z.infer<typeof CorrectionList>;

/** GET /api/v1/corrections: deciders see the school's, others their own requests. */
export const CorrectionListQuery = z
  .object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') })
  .meta({ id: 'CorrectionListQuery' });
export type CorrectionListQuery = z.infer<typeof CorrectionListQuery>;

export const CorrectionIdParam = z.object({ correctionId: z.uuid() });

export const DecideCorrectionRequest = z
  .object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })
  .strict()
  .meta({ id: 'DecideCorrectionRequest' });
export type DecideCorrectionRequest = z.infer<typeof DecideCorrectionRequest>;
