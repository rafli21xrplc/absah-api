import { z } from 'zod';
import { AttendanceStatus } from '../attendance/enums';
import { PklConfirmStatus, PklReviewReason } from './enums';

/**
 * The guru pembimbing's review queue (PKL-02): check-ins outside the radius or hours, with a wrong
 * phone clock or without an industry supervisor (needs_review), disputed ones, and past work days
 * without any check-in. Their decision writes the day's status (source pkl_confirm).
 */

export const PklReviewItem = z
  .object({
    sessionId: z.uuid(),
    date: z.iso.date(),
    placementId: z.uuid(),
    student: z.object({ studentId: z.uuid(), name: z.string(), className: z.string() }),
    partner: z.object({ id: z.uuid(), name: z.string() }),
    /** checkin: a check-in to judge; missing: a work day without check-in. */
    kind: z.enum(['checkin', 'missing']),
    checkIn: z
      .object({
        id: z.uuid(),
        recordedAt: z.iso.datetime(),
        distanceM: z.number().int(),
        accuracyM: z.number().int().nullable(),
        reviewReasons: z.array(PklReviewReason),
        late: z.boolean(),
        confirmStatus: PklConfirmStatus,
        disputeReason: z.string().nullable(),
      })
      .nullable(),
    /** The day's current status (e.g. S from an approved izin), null when none. */
    status: AttendanceStatus.nullable(),
  })
  .meta({ id: 'PklReviewItem' });
export type PklReviewItem = z.infer<typeof PklReviewItem>;

/** GET /api/v1/pkl/reviews: the open queue, oldest first (guru pembimbing: their placements; managers: all). */
export const PklReviewList = z.object({ items: z.array(PklReviewItem) }).meta({ id: 'PklReviewList' });
export type PklReviewList = z.infer<typeof PklReviewList>;

/** POST /api/v1/pkl/days/{sessionId}/decide: the day's status; deciding again replaces it. */
export const DecidePklDayRequest = z.object({ status: AttendanceStatus }).strict().meta({ id: 'DecidePklDayRequest' });
export type DecidePklDayRequest = z.infer<typeof DecidePklDayRequest>;

export const PklSessionIdParam = z.object({ sessionId: z.uuid() });

export const PklDayDecision = z.object({ sessionId: z.uuid(), status: AttendanceStatus }).meta({ id: 'PklDayDecision' });
export type PklDayDecision = z.infer<typeof PklDayDecision>;
