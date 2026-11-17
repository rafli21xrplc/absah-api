import { STAFF_ROLES } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';

const m = schema.tppkMembers;
// Qualified by hand: a bare "user_id" here would resolve to the view's own column.
const memberName = sql<string>`(select d.name from school_member_directory d where d.user_id = "members"."user_id" limit 1)`;

export const listMembers = (tx: Tx) =>
  tx.select({ userId: m.userId, name: memberName, appointedAt: m.createdAt }).from(m).orderBy(asc(m.createdAt), asc(m.userId));

/** Of these users, the ones with an active staff membership in the school (RLS scopes the view). */
export async function activeStaff(tx: Tx, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx.execute<{ user_id: string }>(sql`
    select distinct d.user_id from school_member_directory d
     where d.status = 'active'
       and d.role in (${sql.join(STAFF_ROLES.map((r) => sql`${r}`), sql`, `)})
       and d.user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Set(rows.rows.map((r) => r.user_id));
}

export async function addMembers(tx: Tx, schoolId: string, userIds: string[], appointedBy: string): Promise<void> {
  if (userIds.length === 0) return;
  await tx.insert(m).values(userIds.map((userId) => ({ schoolId, userId, appointedBy })));
}

export async function removeMembers(tx: Tx, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx.delete(m).where(inArray(m.userId, userIds));
}

export async function isMember(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: m.id }).from(m).where(eq(m.userId, userId)).limit(1);
  return row !== undefined;
}
