import { API_KEY_DEFAULT_RATE } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp as at, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

/**
 * Keys of the open API (PLT-09). Only the HMAC of the secret is stored (token_hash); the key is shown once, at creation. A key is
 * switched off by revoked_at, never deleted. The app role updates only last_used_at and the revocation columns.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(API_KEY_DEFAULT_RATE),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    lastUsedAt: at('last_used_at', { withTimezone: true }),
    revokedAt: at('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('api_keys_token_hash_key').on(t.tokenHash),
    index('api_keys_school_id_idx').on(t.schoolId),
    check('api_keys_rate_check', sql`${t.rateLimitPerMinute} between 10 and 600`),
    check('api_keys_scopes_check', sql`cardinality(${t.scopes}) > 0`),
  ],
);

/**
 * Where the school wants outgoing webhooks (PLT-09). The URL may carry a token in its path, so it is encrypted like the secret; the
 * secret signs every delivery (HMAC) and is shown to the admin once. An endpoint can be deleted: its deliveries go with it.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    url: encryptedText('url', 'webhook_endpoints.url').notNull(),
    secret: encryptedText('secret', 'webhook_endpoints.secret').notNull(),
    events: text('events').array().notNull(),
    active: boolean('active').notNull().default(true),
    /** Set when Absah switched the address off by itself (too_many_failures); cleared whenever the admin switches it on or off. */
    disabledReason: text('disabled_reason'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: at('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_endpoints_school_id_idx').on(t.schoolId), check('webhook_endpoints_events_check', sql`cardinality(${t.events}) > 0`)],
);

/**
 * One webhook call to one endpoint for one event (PLT-09). Made by the fan-out consumers (unique per endpoint and event, so a
 * redelivered event adds nothing), completed by the sender: pending -> delivered | failed. The payload holds ids only.
 * Only the outcome columns update; rows go with their endpoint.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    /** The outbox event this call is about; the receiver also gets it as the delivery id, to drop repeats. */
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    finishedAt: at('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('webhook_deliveries_school_id_idx').on(t.schoolId, t.createdAt),
    uniqueIndex('webhook_deliveries_endpoint_event_key').on(t.endpointId, t.eventId),
    check('webhook_deliveries_status_check', sql`${t.status} in ('pending', 'delivered', 'failed')`),
  ],
);
