import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { NotificationStatus } from '@absah/contracts';

const n = schema.notifications;
const STAMP = { sent: 'sentAt', delivered: 'deliveredAt', read: 'readAt', failed: 'failedAt' } as const;

/** Unprocessed WhatsApp status webhooks, oldest first (platform table). */
export function pendingWebhooks(tx: Tx, limit: number) {
  const w = schema.inboxWebhooks;
  return tx
    .select({ id: w.id, payload: w.payload, receivedAt: w.receivedAt })
    .from(w)
    .where(and(eq(w.provider, 'whatsapp'), isNull(w.processedAt)))
    .orderBy(asc(w.receivedAt))
    .limit(limit);
}

/** Which school a provider message belongs to (cross-tenant lookup for webhook processing). */
export async function notificationByProviderId(tx: Tx, providerMessageId: string) {
  const [row] = await tx.select({ id: n.id, schoolId: n.schoolId }).from(n).where(eq(n.providerMessageId, providerMessageId));
  return row;
}

export async function currentStatus(tx: Tx, id: string) {
  const [row] = await tx.select({ status: n.status }).from(n).where(eq(n.id, id)).for('update');
  return row?.status;
}

/** Sets the status (already ranked by the caller), the update's own timestamp if still empty, and the error. */
export async function writeStatus(tx: Tx, id: string, status: NotificationStatus, update: { status: keyof typeof STAMP; at: Date; error?: string }) {
  const key = STAMP[update.status];
  await tx
    .update(n)
    .set({
      status,
      [key]: sql`coalesce(${n[key]}, ${update.at.toISOString()}::timestamptz)`,
      // The error belongs to the final status only: a message delivered after all has none.
      ...(status !== 'failed' ? { lastError: null } : update.status === 'failed' && update.error ? { lastError: update.error } : {}),
    })
    .where(eq(n.id, id));
}

/** Today's counts by status (messages created since the school day began). */
export function countsSince(tx: Tx, since: Date) {
  return tx.select({ status: n.status, count: sql<number>`count(*)::int` }).from(n).where(gte(n.createdAt, since)).groupBy(n.status);
}

export function failedSince(tx: Tx, since: Date, limit = 100) {
  return tx
    .select({
      id: n.id,
      templateCode: n.templateCode,
      toPhone: n.toPhone,
      studentName: schema.students.name,
      attempts: n.attempts,
      lastError: n.lastError,
      createdAt: n.createdAt,
      failedAt: n.failedAt,
    })
    .from(n)
    .leftJoin(schema.enrollments, eq(schema.enrollments.id, n.enrollmentId))
    .leftJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .where(and(eq(n.status, 'failed'), gte(n.createdAt, since)))
    .orderBy(desc(n.createdAt))
    .limit(limit);
}
