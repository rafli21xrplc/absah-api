import { jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { schoolId } from './_shared';
import { schools } from './platform';

/** Setup wizard progress per school (PLT-12), so an admin can stop and continue later. */
export const schoolSetup = pgTable('school_setup', {
  schoolId: schoolId()
    .primaryKey()
    .references(() => schools.id, { onDelete: 'cascade' }),
  /** step id -> 'done' | 'skipped'; missing = todo. */
  steps: jsonb('steps').$type<Record<string, 'done' | 'skipped'>>().notNull().default({}),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
