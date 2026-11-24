import { schema, sensitive, type Tx } from '@absah/db';
import { and, asc, desc, eq, gt, ne, or, isNull, sql } from 'drizzle-orm';

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
    .set({ ...(patch.url === undefined ? {} : { url: sensitive(patch.url) }), ...(patch.events === undefined ? {} : { events: patch.events }), ...(patch.active === undefined ? {} : { active: patch.active, disabledReason: null }), updatedAt: sql`now()` })
    .where(eq(w.id, id))
    .returning();
  return row;
}

export async function deleteWebhook(tx: Tx, id: string): Promise<boolean> {
  return (await tx.delete(w).where(eq(w.id, id)).returning({ id: w.id })).length > 0;
}

const d = schema.webhookDeliveries;

/** Active endpoints of this school that asked for this event type. */
export async function endpointsFor(tx: Tx, eventType: string) {
  return tx.select().from(w).where(and(eq(w.active, true), sql`${eventType} = any(${w.events})`));
}

/** One delivery per endpoint and event: a redelivered event adds nothing and returns no id. */
export async function insertDelivery(tx: Tx, row: { id: string; schoolId: string; endpointId: string; eventId: string; eventType: string; payload: unknown }): Promise<string | null> {
  const [created] = await tx.insert(d).values(row).onConflictDoNothing().returning({ id: d.id });
  return created?.id ?? null;
}

/** The delivery with its endpoint, locked so two workers never post the same call. */
export async function deliveryForSend(tx: Tx, deliveryId: string) {
  const [row] = await tx.select().from(d).where(eq(d.id, deliveryId)).for('update');
  if (!row) return undefined;
  const [endpoint] = await tx.select().from(w).where(eq(w.id, row.endpointId));
  return { delivery: row, endpoint };
}

export async function finishDelivery(tx: Tx, deliveryId: string, outcome: { status: 'delivered' | 'failed'; attempts: number; lastStatus: number | null; lastError: string | null }): Promise<void> {
  await tx.update(d).set({ ...outcome, finishedAt: sql`now()` }).where(eq(d.id, deliveryId));
}

export type DeliveryRow = typeof d.$inferSelect;

/** Newest first. The payload is selected too (the table row), but the view never sends it out. */
export const recentDeliveries = (tx: Tx, endpointId: string, limit: number) =>
  tx.select().from(d).where(eq(d.endpointId, endpointId)).orderBy(desc(d.createdAt), desc(d.id)).limit(limit);

/** A ping of this address that is still waiting and was made in the last `minutes` (an older one is stuck, not waiting). */
export async function pendingTest(tx: Tx, endpointId: string, eventType: string, minutes: number): Promise<boolean> {
  const rows = await tx
    .select({ id: d.id })
    .from(d)
    .where(and(eq(d.endpointId, endpointId), eq(d.eventType, eventType), eq(d.status, 'pending'), gt(d.createdAt, sql`now() - make_interval(mins => ${minutes})`)))
    .limit(1);
  return rows.length > 0;
}

/**
 * The latest finished outcomes of an address that say something about the receiver: no test pings (the admin's own try) and no
 * call that failed only because the address was off, and only those finished after the address was last changed, so switching it
 * on again (or fixing its URL) starts the count over.
 */
export async function recentOutcomes(tx: Tx, endpointId: string, limit: number): Promise<{ status: 'delivered' | 'failed' }[]> {
  const rows = await tx
    .select({ status: d.status })
    .from(d)
    .where(
      and(
        eq(d.endpointId, endpointId),
        ne(d.eventType, 'webhook.test'),
        sql`${d.status} in ('delivered', 'failed')`,
        or(isNull(d.lastError), ne(d.lastError, 'endpoint_off')),
        gt(d.finishedAt, sql`(select e.updated_at from webhook_endpoints e where e.id = ${endpointId})`),
      ),
    )
    .orderBy(desc(d.finishedAt), desc(d.id))
    .limit(limit);
  return rows as { status: 'delivered' | 'failed' }[];
}

/** Switches an address off for good measure; true only when it was on, so it is audited once. */
export async function disableForFailures(tx: Tx, endpointId: string): Promise<boolean> {
  const rows = await tx
    .update(w)
    .set({ active: false, disabledReason: 'too_many_failures', updatedAt: sql`now()` })
    .where(and(eq(w.id, endpointId), eq(w.active, true)))
    .returning({ id: w.id });
  return rows.length > 0;
}
