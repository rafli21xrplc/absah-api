import { z } from 'zod';
import { AttendanceStatus } from '../attendance/enums';
import { PklConfirmStatus } from './enums';

/**
 * The industry supervisor's side (PKL-02, portal /dudi): today's students at their place, one-click
 * confirmation of every pending check-in, a dispute per student. They see statuses, never
 * coordinates or distances.
 */

export const PklSupervisionQuery = z.object({ date: z.iso.date().optional() });

export const PklSupervisionItem = z
  .object({
    placementId: z.uuid(),
    student: z.object({ name: z.string(), className: z.string() }),
    checkIn: z
      .object({
        id: z.uuid(),
        recordedAt: z.iso.datetime(),
        confirmStatus: PklConfirmStatus,
        late: z.boolean(),
        status: AttendanceStatus.nullable(),
        disputeReason: z.string().nullable(),
      })
      .nullable(),
    checkOut: z.object({ recordedAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'PklSupervisionItem' });

/** GET /api/v1/pkl/supervision?date= (pembimbing_industri): their students on a date (default today). */
export const PklSupervisionDay = z
  .object({
    date: z.iso.date(),
    /** Pending check-ins one click would confirm. */
    pending: z.number().int(),
    items: z.array(PklSupervisionItem),
  })
  .meta({ id: 'PklSupervisionDay' });
export type PklSupervisionDay = z.infer<typeof PklSupervisionDay>;

/**
 * POST /api/v1/pkl/checkins/confirm (pembimbing_industri): confirms every pending check-in of their
 * students on the date (default today), or only `checkinIds`. Ids of other supervisors' students: 404.
 */
export const ConfirmPklCheckinsRequest = z
  .object({ date: z.iso.date().optional(), checkinIds: z.array(z.uuid()).min(1).max(100).optional() })
  .strict()
  .meta({ id: 'ConfirmPklCheckinsRequest' });
export type ConfirmPklCheckinsRequest = z.infer<typeof ConfirmPklCheckinsRequest>;

/** POST /api/v1/pkl/checkins/{checkinId}/dispute (pembimbing_industri): a pending check-in only. */
export const DisputePklCheckinRequest = z
  .object({ reason: z.string().trim().min(3, 'Tulis alasan sanggahan.').max(300) })
  .strict()
  .meta({ id: 'DisputePklCheckinRequest' });
export type DisputePklCheckinRequest = z.infer<typeof DisputePklCheckinRequest>;

export const PklCheckinIdParam = z.object({ checkinId: z.uuid() });
