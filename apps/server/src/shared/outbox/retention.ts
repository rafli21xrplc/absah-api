import { sql } from 'drizzle-orm';
import { withPlatform } from '../db';

export const OUTBOX_RETENTION_QUEUE = 'platform.outbox_retention';

/**
 * Deletes published events after 7 days, consumption marks after 30 days (longer than any
 * retry window) and processed webhooks after 30 days. Cross-school, hence withPlatform.
 */
export async function deleteOldOutboxRows(): Promise<{ events: number; consumptions: number; webhooks: number }> {
  return withPlatform(async (tx) => {
    const events = await tx.execute(
      sql`delete from outbox_events where published_at < now() - interval '7 days'`,
    );
    const consumptions = await tx.execute(
      sql`delete from outbox_consumptions where processed_at < now() - interval '30 days'`,
    );
    const webhooks = await tx.execute(
      sql`delete from inbox_webhooks where processed_at < now() - interval '30 days'`,
    );
    return { events: events.rowCount ?? 0, consumptions: consumptions.rowCount ?? 0, webhooks: webhooks.rowCount ?? 0 };
  });
}
