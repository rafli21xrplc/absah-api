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
