import { LEVELS } from '@absah/capabilities';
import { MEMBERSHIP_STATUSES, ROLES } from '@absah/contracts';
import { boolean, index, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';

export const schoolLevel = pgEnum('school_level', LEVELS);
export const membershipRole = pgEnum('membership_role', ROLES);
export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUSES);

/** Collection = yayasan grouping several workspaces (schools). Platform-level, not a tenant table. */
export const collections = pgTable('collections', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/**
 * One row per workspace. The row itself is the tenant, so RLS compares `id` (not school_id)
 * with app.school_id; members may also read the schools they belong to (migration 0003).
 */
export const schools = pgTable(
  'schools',
  {
    id: id(),
    collectionId: uuid('collection_id').references(() => collections.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    level: schoolLevel('level').notNull(),
    isMadrasah: boolean('is_madrasah').notNull().default(false),
    npsn: text('npsn'),
    nsm: text('nsm'),
    createdAt: createdAt(),
  },
  (t) => [
    index('schools_collection_id_idx').on(t.collectionId),
    uniqueIndex('schools_npsn_key').on(t.npsn),
    uniqueIndex('schools_nsm_key').on(t.nsm),
  ],
);

/**
 * A user's role in a school. Teaching roles carry academic_year_id so last year's homeroom
 * teacher does not keep access (FK to academic_years arrives with prompt 2.1).
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
    academicYearId: uuid('academic_year_id'),
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
