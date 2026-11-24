import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

const k = schema.apiKeys;
export type ApiKeyRow = typeof k.$inferSelect;

export const listKeys = (tx: Tx) => tx.select().from(k).orderBy(desc(k.createdAt), asc(k.id));

export async function activeKeyCount(tx: Tx): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(k).where(isNull(k.revokedAt));
  return row?.n ?? 0;
}

export async function insertKey(tx: Tx, row: typeof k.$inferInsert): Promise<ApiKeyRow> {
  const [created] = await tx.insert(k).values(row).returning();
  if (!created) throw new Error('api key not created');
  return created;
}

export async function findKey(tx: Tx, keyId: string) {
  const [row] = await tx.select().from(k).where(eq(k.id, keyId));
  return row;
}

/** Revokes once: a key already revoked keeps its first revocation time. Returns whether this call revoked it. */
export async function revokeKeyRow(tx: Tx, keyId: string, by: string): Promise<boolean> {
  const rows = await tx.update(k).set({ revokedAt: sql`now()`, revokedBy: by }).where(and(eq(k.id, keyId), isNull(k.revokedAt))).returning({ id: k.id });
  return rows.length > 0;
}

/** The key with this hash (in the school of the key, under RLS). */
export async function findKeyByHash(tx: Tx, tokenHash: string) {
  const [row] = await tx.select().from(k).where(eq(k.tokenHash, tokenHash));
  return row;
}

/** Records use at most once a minute: a busy key must not turn every request into a write. */
export async function touchKey(tx: Tx, keyId: string): Promise<void> {
  await tx.update(k).set({ lastUsedAt: sql`now()` }).where(and(eq(k.id, keyId), sql`(${k.lastUsedAt} is null or ${k.lastUsedAt} < now() - interval '1 minute')`));
}

export async function schoolOfKey(tx: Tx, schoolId: string) {
  const s = schema.schools;
  const [row] = await tx.select({ id: s.id, level: s.level, isMadrasah: s.isMadrasah, timezone: s.timezone }).from(s).where(eq(s.id, schoolId));
  return row;
}
