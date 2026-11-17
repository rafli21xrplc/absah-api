import { z } from 'zod';

/** Buku penghubung (ORT-07): one thread per student between home and school. */

/** Who wrote a message, from the sender's link to the student when they wrote it. */
export const LIAISON_SENDER_ROLES = ['orang_tua', 'wali_kelas', 'guru'] as const;
export const LiaisonSenderRole = z.enum(LIAISON_SENDER_ROLES).meta({ id: 'LiaisonSenderRole' });
export type LiaisonSenderRole = z.infer<typeof LiaisonSenderRole>;

/** The sender may retract a message this long after sending; afterwards it is permanent. */
export const LIAISON_RETRACT_MINUTES = 15;
export const LIAISON_MESSAGE_MAX = 2000;

export const LiaisonThreadSummary = z
  .object({
    studentId: z.uuid(),
    studentName: z.string(),
    className: z.string().nullable(),
    lastMessageAt: z.iso.datetime({ offset: true }).nullable(),
    unread: z.number().int(),
  })
  .meta({ id: 'LiaisonThreadSummary' });
export type LiaisonThreadSummary = z.infer<typeof LiaisonThreadSummary>;

export const LiaisonThreadList = z.object({ items: z.array(LiaisonThreadSummary) }).meta({ id: 'LiaisonThreadList' });
export type LiaisonThreadList = z.infer<typeof LiaisonThreadList>;

export const LiaisonMessage = z
  .object({
    id: z.uuid(),
    sender: z.object({ id: z.uuid().nullable(), name: z.string() }),
    senderRole: LiaisonSenderRole,
    /** null for participants once retracted; the admin still sees the text. */
    body: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    retractedAt: z.iso.datetime({ offset: true }).nullable(),
    mine: z.boolean(),
    canRetract: z.boolean(),
  })
  .meta({ id: 'LiaisonMessage' });
export type LiaisonMessage = z.infer<typeof LiaisonMessage>;

export const LiaisonThread = z
  .object({
    student: z.object({ id: z.uuid(), name: z.string(), className: z.string().nullable() }),
    messages: z.array(LiaisonMessage),
    /** Participants write; the admin reads only. */
    canPost: z.boolean(),
  })
  .meta({ id: 'LiaisonThread' });
export type LiaisonThread = z.infer<typeof LiaisonThread>;

export const LiaisonStudentParam = z.object({ studentId: z.uuid() });
export const LiaisonMessageParam = z.object({ messageId: z.uuid() });

export const PostLiaisonMessageRequest = z
  .object({ body: z.string().trim().min(1, 'Pesan tidak boleh kosong.').max(LIAISON_MESSAGE_MAX, `Pesan paling panjang ${LIAISON_MESSAGE_MAX} karakter.`) })
  .strict()
  .meta({ id: 'PostLiaisonMessageRequest' });
export type PostLiaisonMessageRequest = z.infer<typeof PostLiaisonMessageRequest>;

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM.');

/** Service hours: WhatsApp notifications outside them wait for the next start; messages are never held. */
export const LiaisonSettings = z.object({ startsAt: Clock, endsAt: Clock }).meta({ id: 'LiaisonSettings' });
export type LiaisonSettings = z.infer<typeof LiaisonSettings>;
export const LIAISON_DEFAULT_HOURS: LiaisonSettings = { startsAt: '06:00', endsAt: '18:00' };

export const UpdateLiaisonSettingsRequest = LiaisonSettings.strict()
  .refine((v) => v.startsAt < v.endsAt, { message: 'Jam selesai harus setelah jam mulai.', path: ['endsAt'] })
  .meta({ id: 'UpdateLiaisonSettingsRequest' });
export type UpdateLiaisonSettingsRequest = z.infer<typeof UpdateLiaisonSettingsRequest>;

/** GET /api/v1/liaison/students?q=: students the teacher (wali kelas, guru mapel) may write about. */
export const LiaisonStudentQuery = z.object({ q: z.string().trim().min(2, 'Ketik minimal 2 huruf.').max(100) });
export const LiaisonStudentList = z
  .object({ items: z.array(z.object({ id: z.uuid(), name: z.string(), className: z.string().nullable() })) })
  .meta({ id: 'LiaisonStudentList' });
export type LiaisonStudentList = z.infer<typeof LiaisonStudentList>;
