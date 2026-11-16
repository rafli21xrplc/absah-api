import { date, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

/**
 * School overrides of capabilities (PLT-07). One row per key. A deferred change (attendance.mode)
 * keeps the value in force today in previous_value until effective_from (a school date):
 *   effective override = effective_from is null or <= today ? value : previous_value
 * A null value means "no override, use the preset".
 */
export const schoolCapabilities = pgTable(
  'school_capabilities',
  {
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value'),
    previousValue: jsonb('previous_value'),
    effectiveFrom: date('effective_from'),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'school_capabilities_pkey', columns: [t.schoolId, t.key] })],
);

/**
 * Platform kill switches, managed by the Absah team (not by schools). school_id null applies to
 * every school; a row for one school wins over the global row. value is a capability value.
 */
export const platformFlags = pgTable(
  'platform_flags',
  {
    id: id(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('platform_flags_key_school_key').on(t.key, t.schoolId).nullsNotDistinct(),
    index('platform_flags_school_id_idx').on(t.schoolId),
  ],
);
