import { z } from 'zod';
import { MutableTemplateCode } from './enums';

/** With "no late messages" nothing goes to the parent after this school time (minutes since midnight); it waits for 06.00. */
export const NOTIFICATION_LATE_CUTOFF_MINUTES = 19 * 60;

/** GET|PUT /api/v1/portal/notification-preferences (orang tua): the parent's own choices at the active school. */
export const NotificationPreferences = z
  .object({
    /** The WhatsApp number messages go to, masked. Staff change it on the student's contact page. */
    phone: z.string().nullable(),
    /** Message types switched off; the types not listed here still arrive. */
    mutedTypes: z.array(MutableTemplateCode),
    /** Hold messages created after NOTIFICATION_LATE_CUTOFF_MINUTES until 06.00. */
    noLateMessages: z.boolean(),
  })
  .meta({ id: 'NotificationPreferences' });
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const UpdateNotificationPreferencesRequest = z
  .object({
    mutedTypes: z.array(MutableTemplateCode).max(20).transform((types) => [...new Set(types)]),
    noLateMessages: z.boolean(),
  })
  .meta({ id: 'UpdateNotificationPreferencesRequest' });
export type UpdateNotificationPreferencesRequest = z.infer<typeof UpdateNotificationPreferencesRequest>;
