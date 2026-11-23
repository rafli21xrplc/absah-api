import { schema, sensitive, type Tx } from '@absah/db';
import { asc, eq, sql } from 'drizzle-orm';

const w = schema.webhookEndpoints;
export type WebhookRow = typeof w.$inferSelect;

export const listWebhooks = (tx: Tx) => tx.select().from(w).orderBy(asc(w.createdAt), asc(w.id));

export async function webhookCount(tx: Tx): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(w);
  return row?.n ?? 0;
}

export async function findWebhook(tx: Tx, id: string) {
  const [row] = await tx.select().from(w).where(eq(w.id, id));
  return row;
}

export async function insertWebhook(tx: Tx, row: { id: string; schoolId: string; url: string; secret: string; events: string[]; createdBy: string | null }): Promise<WebhookRow> {
  const [created] = await tx.insert(w).values({ ...row, url: sensitive(row.url), secret: sensitive(row.secret) }).returning();
  if (!created) throw new Error('webhook not created');
  return created;
}

export async function updateWebhook(tx: Tx, id: string, patch: { url?: string; events?: string[]; active?: boolean }): Promise<WebhookRow | undefined> {
  const [row] = await tx
    .update(w)
    .set({ ...(patch.url === undefined ? {} : { url: sensitive(patch.url) }), ...(patch.events === undefined ? {} : { events: patch.events }), ...(patch.active === undefined ? {} : { active: patch.active }), updatedAt: sql`now()` })
    .where(eq(w.id, id))
    .returning();
  return row;
}

export async function deleteWebhook(tx: Tx, id: string): Promise<boolean> {
  return (await tx.delete(w).where(eq(w.id, id)).returning({ id: w.id })).length > 0;
}
