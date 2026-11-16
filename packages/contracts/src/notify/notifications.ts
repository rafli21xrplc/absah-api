import { z } from 'zod';
import { NotificationStatus, TemplateCode } from './enums';

/** GET /api/v1/notifications/overview (admin, operator): today's delivery counts and recent failures. */
export const NOTIFICATION_FAILED_DAYS = 7;

export const FailedNotification = z
  .object({
    id: z.uuid(),
    templateCode: TemplateCode,
    /** "+62812****7890": enough to call the parent, not to read the number off a screen share. */
    recipient: z.string(),
    studentName: z.string().nullable(),
    attempts: z.int(),
    lastError: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    failedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'FailedNotification' });
export type FailedNotification = z.infer<typeof FailedNotification>;

export const NotificationOverview = z
  .object({
    schoolDate: z.iso.date(),
    /** Messages created today (school timezone), by current status. */
    counts: z.record(NotificationStatus, z.int()),
    /** Failed in the last NOTIFICATION_FAILED_DAYS days, newest first (at most 100). */
    failed: z.array(FailedNotification),
  })
  .meta({ id: 'NotificationOverview' });
export type NotificationOverview = z.infer<typeof NotificationOverview>;
