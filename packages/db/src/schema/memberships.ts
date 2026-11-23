import { index, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { academicYears } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { membershipRole, membershipStatus, schools } from './platform';

/**
 * A user's role in a school. Teaching roles carry academic_year_id so last year's homeroom
 * teacher does not keep access.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    academicYearId: uuid('academic_year_id').references(() => academicYears.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    index('memberships_school_id_user_id_idx').on(t.schoolId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
    unique('memberships_school_user_role_year_key')
      .on(t.schoolId, t.userId, t.role, t.academicYearId)
      .nullsNotDistinct(),
  ],
);
