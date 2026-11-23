import { POINT_KINDS, UKS_OUTCOMES } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const uksOutcome = pgEnum('uks_outcome', UKS_OUTCOMES);
export const pointKind = pgEnum('point_kind', POINT_KINDS);

/**
 * Kesiswaan (KSW). UKS visits (KSW-08): insert-only, because a dipulangkan visit has already
 * marked attendance and told the parents. Complaint and action are encrypted (CLAUDE.md rule 9).
 */
export const uksVisits = pgTable(
  'uks_visits',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
    complaint: encryptedText('complaint', 'uks_visits.complaint').notNull(),
    action: encryptedText('action', 'uks_visits.action'),
    outcome: uksOutcome('outcome').notNull(),
    recordedBy: uuid('recorded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('uks_visits_school_id_school_date_idx').on(t.schoolId, t.schoolDate, t.visitedAt),
    index('uks_visits_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId, t.visitedAt),
  ],
);

/**
 * Point rules (KSW-01): one table per school. Pelanggaran are negative, prestasi positive (check),
 * switched off with active = false so entries keep pointing at them.
 */
export const pointRules = pgTable(
  'point_rules',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    kind: pointKind('kind').notNull(),
    category: text('category').notNull(),
    name: text('name').notNull(),
    points: smallint('points').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('point_rules_school_id_name_key').on(t.schoolId, sql`lower(${t.name})`),
    check('point_rules_points_check', sql`(${t.kind} = 'violation' and ${t.points} between -100 and -1) or (${t.kind} = 'achievement' and ${t.points} between 1 and 100)`),
  ],
);
