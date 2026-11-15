import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

export const idempotencyStatus = pgEnum('idempotency_status', ['in_progress', 'completed']);

/**
 * Idempotency-Key records (PLT-13), scoped to school + caller. The stored response is encrypted
 * (it can contain personal data) and kept 24 hours.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatus('status').notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: encryptedText('response_body', 'idempotency_keys.response_body'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_keys_school_user_key').on(t.schoolId, t.userId, t.key).nullsNotDistinct(),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
  ],
);
