import { z } from 'zod';
import { AttendanceStatus } from '../attendance/enums';
import { PklCheckinKind, PklConfirmStatus, PklReviewReason } from './enums';

/**
 * Check-in / check-out from the student's phone (PKL-02). The location is read only when the student
 * presses the button; the server measures the distance to the DUDI and keeps a point rounded to
 * 4 decimals. Idempotency-Key is required.
 */
export const PklCheckinBody = z
  .object({
    kind: PklCheckinKind,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** GPS accuracy in metres as the browser reports it; stored, never widens the radius. */
    accuracyM: z.number().min(0).max(100_000).optional(),
    /** The phone's clock when the button was pressed; more than 10 minutes off sends it to review. */
    deviceTime: z.iso.datetime({ offset: true }),
  })
  .strict()
  .meta({ id: 'PklCheckinBody' });
export type PklCheckinBody = z.infer<typeof PklCheckinBody>;

/** What the student sees of their own check-in (no coordinates). */
export const PklCheckin = z
  .object({
    id: z.uuid(),
    kind: PklCheckinKind,
    schoolDate: z.iso.date(),
    recordedAt: z.iso.datetime(),
    distanceM: z.number().int(),
    reviewReasons: z.array(PklReviewReason),
    late: z.boolean(),
    /** null for check-outs. */
    confirmStatus: PklConfirmStatus.nullable(),
    /** The day's status once confirmed or decided (H, T, or the guru pembimbing's decision). */
    status: AttendanceStatus.nullable(),
  })
  .meta({ id: 'PklCheckin' });
export type PklCheckin = z.infer<typeof PklCheckin>;

/** GET /api/v1/pkl/me: the student's running placement and today's check-in/out. */
export const PklToday = z
  .object({
    date: z.iso.date(),
    placement: z
      .object({
        id: z.uuid(),
        partner: z.object({ name: z.string(), address: z.string(), radiusM: z.number().int() }),
        startsOn: z.iso.date(),
        endsOn: z.iso.date(),
        schoolMentor: z.string().nullable(),
        industryMentor: z.string().nullable(),
        /** Today's working hours (HH:MM), null when the DUDI is closed today. */
        hours: z.object({ startsAt: z.string(), endsAt: z.string() }).nullable(),
      })
      .nullable(),
    checkIn: PklCheckin.nullable(),
    checkOut: PklCheckin.nullable(),
  })
  .meta({ id: 'PklToday' });
export type PklToday = z.infer<typeof PklToday>;
