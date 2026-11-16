import { withPlatform, withTenant } from '../../../shared/db';
import { markWebhookProcessed, recordWebhook } from '../../../shared/outbox';
import { nextStatus, type StatusUpdate } from '../domain/status';
import { currentStatus, notificationByProviderId, pendingWebhooks, writeStatus } from '../infrastructure/status-repo';

/** A status for a message we have not stored yet (send still committing) waits this long. */
const ORPHAN_AFTER_MS = 24 * 60 * 60_000;

/** Stores each status once (provider id + status is unique), for the worker to apply. */
export async function recordStatusUpdates(updates: StatusUpdate[]): Promise<number> {
  let stored = 0;
  for (const u of updates) {
    const { duplicate } = await recordWebhook('whatsapp', `${u.providerMessageId}:${u.status}`, { ...u, at: u.at.toISOString() });
    if (!duplicate) stored += 1;
  }
  return stored;
}

/**
 * Applies stored status webhooks. The school is unknown until the message is found, so the lookup
 * and the inbox reads use withPlatform (webhook inbox maintenance); the change itself runs in the
 * school's withTenant transaction. Ranks make the final status right in any arrival order.
 */
export async function processStatusWebhooks(now = new Date(), limit = 500): Promise<{ applied: number; waiting: number }> {
  // withPlatform: inbox_webhooks is a platform table and the message's school is not known yet.
  const rows = await withPlatform((tx) => pendingWebhooks(tx, limit));
  let applied = 0;
  let waiting = 0;
  for (const row of rows) {
    const p = row.payload as { providerMessageId: string; status: StatusUpdate['status']; at: string; error?: string };
    const target = await withPlatform((tx) => notificationByProviderId(tx, p.providerMessageId));
    if (!target) {
      if (now.getTime() - row.receivedAt.getTime() > ORPHAN_AFTER_MS) await markWebhookProcessed(row.id);
      else waiting += 1;
      continue;
    }
    await withTenant({ schoolId: target.schoolId, userId: null }, async (tx) => {
      const current = await currentStatus(tx, target.id);
      if (!current) return;
      await writeStatus(tx, target.id, nextStatus(current, p), { status: p.status, at: new Date(p.at), error: p.error });
    });
    await markWebhookProcessed(row.id);
    applied += 1;
  }
  return { applied, waiting };
}
