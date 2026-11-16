import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, schoolId } from './_shared';
import { memberships } from './memberships';
import { schools } from './platform';

/**
 * Invitation links for invited memberships (PLT-12). The token is "<schoolId>.<secret>"; only an
 * HMAC of it is stored. The school part lets acceptance run inside withTenant without bypassing RLS.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_school_id_membership_id_idx').on(t.schoolId, t.membershipId)],
);
