import type { Level } from '@absah/capabilities';
import type { Role } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { withUser } from '../../../shared/db';

export interface CollectionSchool {
  collectionId: string;
  collectionName: string;
  schoolId: string;
  schoolName: string;
  level: Level;
  isMadrasah: boolean;
  timezone: string;
  roles: Role[];
}

/**
 * The user's active memberships in schools that belong to a collection, with one of `roles`. Under withUser row-level security:
 * a person only ever sees the schools they are a member of, so this cannot list a school of the collection they have no seat in.
 */
export async function collectionSchools(userId: string, roles: readonly Role[]): Promise<CollectionSchool[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        collectionId: schema.collections.id,
        collectionName: schema.collections.name,
        schoolId: schema.schools.id,
        schoolName: schema.schools.name,
        level: schema.schools.level,
        isMadrasah: schema.schools.isMadrasah,
        timezone: schema.schools.timezone,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .innerJoin(schema.schools, eq(schema.schools.id, schema.memberships.schoolId))
      .innerJoin(schema.collections, eq(schema.collections.id, schema.schools.collectionId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active'), isNotNull(schema.schools.collectionId), inArray(schema.memberships.role, [...roles]))),
  );
  const bySchool = new Map<string, CollectionSchool>();
  for (const { role, ...r } of rows) {
    const entry = bySchool.get(r.schoolId) ?? { ...r, roles: [] };
    if (!entry.roles.includes(role)) entry.roles.push(role);
    bySchool.set(r.schoolId, entry);
  }
  return [...bySchool.values()];
}
