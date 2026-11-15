import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/** UUIDv7 primary key (time ordered), generated in the app because Postgres 16 lacks uuidv7(). */
export const id = () => uuid('id').primaryKey().$defaultFn(() => uuidv7());

/** Every tenant table uses this column, an index starting with it, and an RLS policy. */
export const schoolId = () => uuid('school_id').notNull();

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
