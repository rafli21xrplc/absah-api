import { z } from 'zod';

/**
 * BK notes (KSW-05, behind student.counseling): what the guru BK writes after a counselling session, with a
 * follow-up status. Only guru BK and admin can read them (the database enforces it, not only the API): not the
 * wali kelas, kepsek or wakasek. The note is encrypted, and it never appears in the audit log or any log.
 */
export const COUNSELING_FOLLOW_UPS = ['none', 'planned', 'done'] as const;
export const CounselingFollowUp = z.enum(COUNSELING_FOLLOW_UPS).meta({ id: 'CounselingFollowUp' });
export type CounselingFollowUp = z.infer<typeof CounselingFollowUp>;

export const COUNSELING_NOTE_MAX_LENGTH = 2000;

/** POST /api/v1/counseling-notes (guru BK): date defaults to today and cannot be in the future. */
export const CreateCounselingNoteRequest = z
  .object({
    enrollmentId: z.uuid(),
    date: z.iso.date().optional(),
    note: z.string().trim().min(1, 'Tulis catatan.').max(COUNSELING_NOTE_MAX_LENGTH),
    /** none (default): nothing to follow up; planned: a follow-up is due, optionally on followUpOn. */
    followUp: z.enum(['none', 'planned']).default('none'),
    followUpOn: z.iso.date().optional(),
  })
  .strict()
  .refine((r) => r.followUp === 'planned' || r.followUpOn === undefined, { path: ['followUpOn'], message: 'Tanggal tindak lanjut hanya untuk tindak lanjut yang direncanakan.' })
  .meta({ id: 'CreateCounselingNoteRequest' });
export type CreateCounselingNoteRequest = z.infer<typeof CreateCounselingNoteRequest>;

export const CounselingNoteIdParam = z.object({ noteId: z.uuid() });

export const CounselingNote = z
  .object({
    id: z.uuid(),
    student: z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    date: z.iso.date(),
    note: z.string(),
    followUp: CounselingFollowUp,
    followUpOn: z.iso.date().nullable(),
    followedUpAt: z.iso.datetime().nullable(),
    recordedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  })
  .meta({ id: 'CounselingNote' });
export type CounselingNote = z.infer<typeof CounselingNote>;

/** GET /api/v1/counseling-notes[?enrollmentId=&followUp=] (guru BK, admin): newest first, at most 200. The read is audited. */
export const CounselingNotesQuery = z.object({ enrollmentId: z.uuid().optional(), followUp: CounselingFollowUp.optional() }).meta({ id: 'CounselingNotesQuery' });
export type CounselingNotesQuery = z.infer<typeof CounselingNotesQuery>;

export const CounselingNoteList = z.object({ items: z.array(CounselingNote) }).meta({ id: 'CounselingNoteList' });
export type CounselingNoteList = z.infer<typeof CounselingNoteList>;
