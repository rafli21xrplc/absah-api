import { z } from 'zod';
import { SessionStatus } from './enums';

/** Jurnal mengajar (PRS-09): the topic a teacher writes when filling a per-period session. */

export const TOPIC_MAX_LENGTH = 200;

/** Optional free text on POST /sessions/{id}/submit; an empty string clears it, omitting keeps it. */
export const SessionTopic = z.string().trim().max(TOPIC_MAX_LENGTH, `Topik paling banyak ${TOPIC_MAX_LENGTH} karakter.`);

const Ref = z.object({ id: z.uuid(), name: z.string() });

/** GET /api/v1/teaching-journal and its Excel export: one month, one teacher (managers: any or all). */
export const JournalQuery = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Bulan berformat YYYY-MM.'),
    /** Managers (admin, kepsek, wakasek) may pick another teacher; everyone else sees only themselves. */
    teacherId: z.uuid().optional(),
  })
  .meta({ id: 'JournalQuery' });
export type JournalQuery = z.infer<typeof JournalQuery>;

export const JournalEntry = z
  .object({
    sessionId: z.uuid(),
    schoolDate: z.iso.date(),
    period: z.object({ number: z.int(), startsAt: z.string(), endsAt: z.string() }).nullable(),
    className: z.string(),
    subject: Ref.nullable(),
    teacher: Ref.nullable(),
    status: SessionStatus,
    /** Null while the teacher has not written one. */
    topic: z.string().nullable(),
  })
  .meta({ id: 'JournalEntry' });
export type JournalEntry = z.infer<typeof JournalEntry>;

export const JournalResponse = z
  .object({
    month: z.string(),
    entries: z.array(JournalEntry),
    /** Sessions in the month, and how many of them have a topic. */
    totals: z.object({ sessions: z.int(), withTopic: z.int() }),
  })
  .meta({ id: 'JournalResponse' });
export type JournalResponse = z.infer<typeof JournalResponse>;
