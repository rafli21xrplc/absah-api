import { z } from 'zod';
import { LessonTime } from '../academic/schedule';
import { PhoneNumberId } from '../platform/invitations';

/** Jumlah hadir MBG (RKP-08): present students per rombel at the school's cutoff time. */

/** The cutoff when a school has not set one. */
export const MBG_DEFAULT_CUTOFF = '08:30';

/** GET /api/v1/mbg/settings. The PIC number is masked. */
export const MbgSettings = z
  .object({
    cutoffTime: LessonTime,
    picName: z.string().nullable(),
    picPhone: z.string().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'MbgSettings' });
export type MbgSettings = z.infer<typeof MbgSettings>;

/**
 * PUT /api/v1/mbg/settings. picPhone left out keeps the stored number (the API never returns it in
 * full); null removes it. Without a PIC number the counts are kept but not sent.
 */
export const UpdateMbgSettingsRequest = z
  .object({
    cutoffTime: LessonTime,
    picName: z.string().trim().min(1).max(100).nullable(),
    picPhone: PhoneNumberId.nullable().optional(),
  })
  .strict()
  .meta({ id: 'UpdateMbgSettingsRequest' });
export type UpdateMbgSettingsRequest = z.infer<typeof UpdateMbgSettingsRequest>;

const MbgCount = z.object({
  /** Active students of the rombel that day. */
  enrolled: z.int().nonnegative(),
  /** H or T in the day's rekap. Sakit, izin and alpa are not counted. */
  present: z.int().nonnegative(),
  /** Students without any attendance yet (session not filled); not counted as present. */
  unrecorded: z.int().nonnegative(),
});

/**
 * GET /api/v1/mbg/daily?date=: before the cutoff (status pending) the numbers are live; after it
 * (counted) they are the numbers stored at the cutoff, or the latest correction of them.
 */
export const MbgDaily = z
  .object({
    date: z.iso.date(),
    cutoffTime: LessonTime,
    status: z.enum(['pending', 'counted', 'not_school_day']),
    /** When the cutoff count was stored; null while pending. */
    countedAt: z.iso.datetime().nullable(),
    /** When the count went to the PIC; null when no PIC number was set. */
    sentAt: z.iso.datetime().nullable(),
    total: MbgCount,
    classes: z.array(
      MbgCount.extend({
        classId: z.uuid(),
        name: z.string(),
        /** The stored number was corrected after the cutoff. */
        corrected: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'MbgDaily' });
export type MbgDaily = z.infer<typeof MbgDaily>;

export const MbgDailyQuery = z.object({ date: z.iso.date().optional() }).meta({ id: 'MbgDailyQuery' });
export type MbgDailyQuery = z.infer<typeof MbgDailyQuery>;
