import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

/**
 * Transactional outbox (PLT-13). Use cases append events with emit() in their own transaction;
 * the worker relay moves them to pg-boss. Payloads carry ids, not personal data.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    traceId: text('trace_id'),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_events_school_id_created_at_idx').on(t.schoolId, t.createdAt),
    index('outbox_events_unpublished_idx').on(t.createdAt).where(sql`${t.publishedAt} is null`),
  ],
);

/** One row per (consumer, event) handled, written in the handler's transaction: retries skip it. */
export const outboxConsumptions = pgTable(
  'outbox_consumptions',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'outbox_consumptions_pkey', columns: [t.consumer, t.eventId] }),
    index('outbox_consumptions_school_id_idx').on(t.schoolId, t.processedAt),
  ],
);

/** Incoming webhooks (WhatsApp, payments), deduplicated by the provider's own id. Platform table. */
export const inboxWebhooks = pgTable(
  'inbox_webhooks',
  {
    id: id(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    unique('inbox_webhooks_provider_external_id_key').on(t.provider, t.externalId),
    index('inbox_webhooks_unprocessed_idx').on(t.receivedAt).where(sql`${t.processedAt} is null`),
  ],
);
