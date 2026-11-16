import { LEVELS } from '@absah/capabilities';
import { MEMBERSHIP_STATUSES, ROLES } from '@absah/contracts';
import { boolean, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_shared';

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
