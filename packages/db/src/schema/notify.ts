import { NOTIFICATION_STATUSES, TEMPLATE_APPROVALS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { enrollments, guardians } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

export const notificationStatus = pgEnum('notification_status', NOTIFICATION_STATUSES);
export const templateApproval = pgEnum('template_approval', TEMPLATE_APPROVALS);

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * WhatsApp message templates (platform data: Absah has one sender number, the school name is a
 * parameter). The body uses {{name}} placeholders; params lists them in the order the provider
 * expects. Only the Absah team changes rows (owner role); the app role reads them.
 */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: id(),
    code: text('code').notNull(),
    language: text('language').notNull().default('id'),
    body: text('body').notNull(),
    params: text('params').array().notNull(),
    /** Template name registered at the provider. */
    providerName: text('provider_name').notNull(),
    approval: templateApproval('approval').notNull().default('draft'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('message_templates_code_language_key').on(t.code, t.language)],
);

/**
 * One WhatsApp message to one recipient (NTF). dedup_key makes the same event (or the same alpa
 * on the same day) produce one message. Phone and parameters are encrypted; the parameters hold
 * only what the message shows (first name, status, school, link).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    dedupKey: text('dedup_key').notNull(),
    /** The outbox event that caused it. */
    eventId: uuid('event_id'),
    guardianId: uuid('guardian_id').references(() => guardians.id, { onDelete: 'set null' }),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'set null' }),
    templateCode: text('template_code').notNull(),
    language: text('language').notNull().default('id'),
    toPhone: encryptedText('to_phone', 'notifications.to_phone').notNull(),
    /** JSON object of template parameters. */
    params: encryptedText('params', 'notifications.params').notNull(),
    status: notificationStatus('status').notNull().default('queued'),
    /** Not before this time (quiet hours push it to the morning). */
    scheduledFor: at('scheduled_for').notNull().defaultNow(),
    /** When it was handed to the sender (event notification.queued). */
    releasedAt: at('released_at'),
    attempts: integer('attempts').notNull().default(0),
    /** Provider error code or short reason; never message content. */
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    sentAt: at('sent_at'),
    deliveredAt: at('delivered_at'),
    readAt: at('read_at'),
    failedAt: at('failed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('notifications_school_id_dedup_key_key').on(t.schoolId, t.dedupKey),
    index('notifications_school_id_status_created_at_idx').on(t.schoolId, t.status, t.createdAt),
    index('notifications_school_id_unreleased_idx').on(t.schoolId, t.scheduledFor).where(sql`${t.releasedAt} is null`),
    uniqueIndex('notifications_provider_message_id_key').on(t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
  ],
);

/**
 * A parent's choices for the messages that go to their number (ORT-06), one row per guardian
 * (guardians are per school). No row = the defaults: every message, outside the quiet hours.
 * muted_types only ever holds MUTABLE_TEMPLATE_CODES; the API validates it.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    guardianId: uuid('guardian_id')
      .primaryKey()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    mutedTypes: text('muted_types').array().notNull().default(sql`'{}'::text[]`),
    noLateMessages: boolean('no_late_messages').notNull().default(false),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('notification_preferences_school_id_idx').on(t.schoolId)],
);
