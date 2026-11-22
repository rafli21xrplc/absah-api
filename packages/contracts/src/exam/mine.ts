import { z } from 'zod';
import { EligibilityReason } from './eligibility';
import type { Role } from '../platform/roles';

/** UJN-01: a parent or the student sees the exam card status of their own children, and nobody else's. */
export const EXAM_CARD_HOLDERS = ['orang_tua', 'siswa'] as const satisfies readonly Role[];

export const MyExam = z
  .object({
    studentId: z.uuid(),
    enrollmentId: z.uuid(),
    student: z.object({ name: z.string() }),
    className: z.string(),
    period: z.object({ id: z.uuid(), name: z.string(), startsOn: z.string(), endsOn: z.string() }),
    /** "Boleh ujian": by the school's rule, right now. When false, the reasons say what to settle with the school. */
    eligible: z.boolean(),
    reasons: z.array(EligibilityReason),
    /** Where to sit; null until the school has arranged the rooms. */
    room: z.object({ name: z.string(), seatNo: z.number().int() }).nullable(),
    /** Already checked in at the room for this exam. */
    arrived: z.boolean(),
  })
  .meta({ id: 'MyExam' });
export type MyExam = z.infer<typeof MyExam>;

/**
 * The exam card of the student: the QR on it is the same dynamic QR as the daily card (GET /cards/mine and the card
 * device keys), shown by the PWA while an exam is open and the student may sit.
 */
export const MyExams = z.object({ items: z.array(MyExam) }).meta({ id: 'MyExams' });
export type MyExams = z.infer<typeof MyExams>;
