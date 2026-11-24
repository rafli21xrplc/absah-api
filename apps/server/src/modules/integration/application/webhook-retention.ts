import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withPlatform } from '../../../shared/db';

export const WEBHOOK_RETENTION_QUEUE = 'integration.webhook_retention';

/** How long a finished call (delivered or failed) stays visible; a school can look back this far. */
export const WEBHOOK_RETENTION_DAYS = 30;

/**
 * Deletes webhook calls 30 days after they finished. A call that never finished (no finished_at) is counted from when it was
 * made, so one stuck forever does not stay either. The outbox keeps events for 7 days and consumption marks for 30, so no
 * event can come back after its call is gone. Cross-school, hence withPlatform (the app role has no DELETE on this table).
 */
export async function deleteOldWebhookDeliveries(): Promise<number> {
  return withPlatform(async (tx) => {
    const rows = await tx.execute(
      sql`delete from webhook_deliveries where coalesce(finished_at, created_at) < now() - make_interval(days => ${WEBHOOK_RETENTION_DAYS})`,
    );
    return rows.rowCount ?? 0;
  });
}

export function webhookRetentionHandler(logger: Logger) {
  return async (): Promise<void> => {
    const deleted = await deleteOldWebhookDeliveries();
    logger.info({ deleted, queue: WEBHOOK_RETENTION_QUEUE }, 'old webhook deliveries deleted');
  };
}
