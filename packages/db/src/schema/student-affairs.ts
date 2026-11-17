import { UKS_OUTCOMES } from '@absah/contracts';
import { date, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const uksOutcome = pgEnum('uks_outcome', UKS_OUTCOMES);

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
