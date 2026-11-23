import { schema, type Tx } from '@absah/db';
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const v = schema.visitors;

const hostName = directoryName(v.hostUserId);

const columns = {
  id: v.id,
  schoolDate: v.schoolDate,
  name: v.name,
  organization: v.organization,
  purpose: v.purpose,
  hostUserId: v.hostUserId,
  hostName,
  arrivedAt: v.arrivedAt,
  leftAt: v.leftAt,
  hasPhoto: sql<boolean>`(${v.photoKey} is not null and ${v.photoRemovedAt} is null)`,
};
export type VisitorRow = {
  id: string;
  schoolDate: string;
  name: string;
  organization: string | null;
  purpose: string;
  hostUserId: string | null;
  hostName: string | null;
  arrivedAt: Date;
  leftAt: Date | null;
  hasPhoto: boolean;
};

export async function findVisitor(tx: Tx, id: string): Promise<VisitorRow | undefined> {
  const [row] = await tx.select(columns).from(v).where(eq(v.id, id));
  return row;
}

export async function findByClientEvent(tx: Tx, clientEventId: string): Promise<VisitorRow | undefined> {
  const [row] = await tx.select(columns).from(v).where(eq(v.clientEventId, clientEventId));
  return row;
}

export interface NewVisitor {
  id: string;
  schoolId: string;
  schoolDate: string;
  clientEventId: string;
  kioskId: string;
  name: string;
  organization: string | null;
  purpose: string;
  hostUserId: string | null;
  photoKey: string | null;
}

/** False when this clientEventId was recorded before (a resend). */
export async function insertVisitor(tx: Tx, row: NewVisitor): Promise<boolean> {
  const inserted = await tx.insert(v).values(row).onConflictDoNothing().returning({ id: v.id });
  return inserted.length > 0;
}

export function visitorsOfDay(tx: Tx, schoolDate: string, insideOnly: boolean): Promise<VisitorRow[]> {
  return tx
    .select(columns)
    .from(v)
    .where(and(eq(v.schoolDate, schoolDate), insideOnly ? isNull(v.leftAt) : undefined))
    .orderBy(desc(v.arrivedAt), desc(v.id));
}

export async function countInside(tx: Tx, schoolDate: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(v).where(and(eq(v.schoolDate, schoolDate), isNull(v.leftAt)));
  return row?.n ?? 0;
}

/** Locks the visit row so two piket signing out at once leave one left_at. */
export async function lockVisitor(tx: Tx, id: string) {
  const [row] = await tx.select({ id: v.id, leftAt: v.leftAt }).from(v).where(eq(v.id, id)).for('update');
  return row;
}

export async function markLeft(tx: Tx, id: string, userId: string, at: Date): Promise<void> {
  await tx.update(v).set({ leftAt: at, leftBy: userId }).where(eq(v.id, id));
}

/** Active staff a guest can name: everyone but parents, students and industry supervisors. */
export async function hostCandidates(tx: Tx): Promise<{ id: string; name: string }[]> {
  const result = await tx.execute(sql`
    select distinct on (user_id) user_id as id, name from school_member_directory
    where status = 'active' and role not in ('orang_tua', 'siswa', 'pembimbing_industri')
    order by user_id`);
  return (result.rows as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export async function isHostCandidate(tx: Tx, userId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    select 1 from school_member_directory
    where user_id = ${userId} and status = 'active' and role not in ('orang_tua', 'siswa', 'pembimbing_industri') limit 1`);
  return result.rows.length > 0;
}

/** The photo object of a visit that still has one. */
export async function photoKeyOf(tx: Tx, id: string): Promise<string | null | undefined> {
  const [row] = await tx.select({ key: v.photoKey, removedAt: v.photoRemovedAt }).from(v).where(eq(v.id, id));
  if (!row) return undefined;
  return row.removedAt ? null : row.key;
}

/** Visits whose photo is due for removal (platform job, across schools). */
export function photosDueForRemoval(tx: Tx, cutoff: Date) {
  return tx
    .select({ id: v.id, photoKey: v.photoKey })
    .from(v)
    .where(and(isNotNull(v.photoKey), isNull(v.photoRemovedAt), lt(sql`coalesce(${v.leftAt}, ${v.arrivedAt})`, cutoff)));
}

export async function markPhotoRemoved(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(v).set({ photoRemovedAt: at }).where(eq(v.id, id));
}
