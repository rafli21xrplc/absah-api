import type { Logger } from 'pino';
import { withPlatform, withTenant } from '../../../shared/db';
import { emit } from '../../../shared/outbox';
import { dueNotifications, dueSchoolsSql, markReleased } from '../infrastructure/notify-repo';

export const NOTIFY_RELEASE_QUEUE = 'notify.release';
export const NOTIFY_RELEASE_CRON = '* * * * *';

/**
 * Releases messages held by the quiet hours once they are due. Finding the schools reads across
 * tenants (withPlatform, maintenance job like the outbox relay); each school's release then runs
 * in its own withTenant transaction.
 */
export async function releaseDueNotifications(now = new Date()): Promise<number> {
  // withPlatform: cross-school maintenance read of school ids only.
  const schools = await withPlatform(async (tx) => (await tx.execute<{ school_id: string }>(dueSchoolsSql(now))).rows.map((r) => r.school_id));
  let released = 0;
  for (const schoolId of schools) {
    released += await withTenant({ schoolId, userId: null }, async (tx) => {
      const ids = (await dueNotifications(tx, now)).map((r) => r.id);
      await markReleased(tx, ids, now);
      for (const notificationId of ids) await emit(tx, 'notification.queued', { notificationId });
      return ids.length;
    });
  }
  return released;
}

export function releaseHandler(logger: Logger) {
  return async () => {
    const released = await releaseDueNotifications();
    if (released > 0) logger.info({ released, queue: NOTIFY_RELEASE_QUEUE }, 'held notifications released');
  };
}
