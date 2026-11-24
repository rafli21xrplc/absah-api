import { API_KEY_DEFAULT_RATE } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp as at, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
