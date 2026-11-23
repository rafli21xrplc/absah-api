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
