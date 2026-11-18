import { z } from 'zod';
import { PresignedUpload } from '../academic/imports';
import { PklJournalStatus } from './enums';

/**
 * Daily PKL journal (PKL-03): what the student did at the DUDI, the competency practised and an
 * optional photo or file (R2, schools/{id}/pkl/{uuid}). The guru pembimbing or the industry
 * supervisor approves it or asks for a revision.
 */

/** A journal may be written for today or up to this many days back, inside the placement. */
export const PKL_JOURNAL_MAX_BACKDATE_DAYS = 7;
export const PKL_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const PKL_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const PklAttachmentType = z.enum(PKL_ATTACHMENT_TYPES).meta({ id: 'PklAttachmentType' });

/** POST /api/v1/pkl/journals/attachments (siswa): a presigned PUT for a photo or file. */
export const CreatePklAttachmentRequest = z
  .object({ fileSize: z.int().positive().max(PKL_ATTACHMENT_MAX_BYTES, 'Lampiran maksimal 5 MB.'), contentType: PklAttachmentType })
  .strict()
  .meta({ id: 'CreatePklAttachmentRequest' });
export type CreatePklAttachmentRequest = z.infer<typeof CreatePklAttachmentRequest>;

export const CreatePklAttachmentResponse = z.object({ attachmentId: z.uuid(), upload: PresignedUpload }).meta({ id: 'CreatePklAttachmentResponse' });
export type CreatePklAttachmentResponse = z.infer<typeof CreatePklAttachmentResponse>;

/**
 * POST /api/v1/pkl/journals (siswa): writes the journal of a date (default today), or rewrites it
 * while not approved (a revision goes back to submitted). attachment: undefined keeps, null removes.
 */
export const WritePklJournalRequest = z
  .object({
    date: z.iso.date().optional(),
    activity: z.string().trim().min(5, 'Ceritakan kegiatanmu minimal 5 huruf.').max(2000),
    competency: z.string().trim().max(300).nullable().optional(),
    attachment: z.object({ id: z.uuid(), contentType: PklAttachmentType }).strict().nullable().optional(),
  })
  .strict()
  .meta({ id: 'WritePklJournalRequest' });
export type WritePklJournalRequest = z.infer<typeof WritePklJournalRequest>;

export const PklJournal = z
  .object({
    id: z.uuid(),
    placementId: z.uuid(),
    student: z.object({ name: z.string(), className: z.string() }),
    partnerName: z.string(),
    date: z.iso.date(),
    activity: z.string(),
    competency: z.string().nullable(),
    attachmentType: PklAttachmentType.nullable(),
    status: PklJournalStatus,
    reviewNote: z.string().nullable(),
    reviewer: z.string().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    /** The caller may approve or ask for a revision (a supervisor of the placement). */
    canReview: z.boolean(),
  })
  .meta({ id: 'PklJournal' });
export type PklJournal = z.infer<typeof PklJournal>;

export const PklJournalList = z.object({ items: z.array(PklJournal) }).meta({ id: 'PklJournalList' });
export type PklJournalList = z.infer<typeof PklJournalList>;

/**
 * GET /api/v1/pkl/journals: the student's own; a supervisor's placements; managers all. Newest first,
 * default the last 31 days.
 */
export const PklJournalQuery = z
  .object({ placementId: z.uuid().optional(), status: PklJournalStatus.optional(), from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'Tanggal akhir tidak boleh sebelum tanggal awal.', path: ['to'] });
export type PklJournalQuery = z.infer<typeof PklJournalQuery>;

/** POST /api/v1/pkl/journals/{journalId}/review: approve, or ask for a revision with a note. */
export const ReviewPklJournalRequest = z
  .object({ decision: z.enum(['approved', 'revision']), note: z.string().trim().max(300).optional() })
  .strict()
  .refine((v) => v.decision === 'approved' || (v.note?.length ?? 0) > 0, { message: 'Tulis apa yang perlu diperbaiki.', path: ['note'] })
  .meta({ id: 'ReviewPklJournalRequest' });
export type ReviewPklJournalRequest = z.infer<typeof ReviewPklJournalRequest>;

export const PklJournalIdParam = z.object({ journalId: z.uuid() });

export const PklAttachmentLink = z.object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) }).meta({ id: 'PklAttachmentLink' });
export type PklAttachmentLink = z.infer<typeof PklAttachmentLink>;
