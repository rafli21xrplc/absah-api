import { NOTIFICATION_FAILED_DAYS, NOTIFICATION_STATUSES, TemplateCode, type NotificationOverview } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { ForbiddenError } from '../../../shared/errors';
import { firstName } from '../../../shared/names';
import type { Actor } from '../../../shared/policy';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { canSeeNotifications } from '../domain/policies';
import { maskPhone } from '../domain/messages';
import { countsSince, failedSince } from '../infrastructure/status-repo';

/** The delivery dashboard (NTF): today's counts and failures of the last week, masked. */
export function notificationOverview(actor: Actor, timezone: string, now = new Date()): Promise<NotificationOverview> {
  if (!canSeeNotifications.allows(actor)) throw new ForbiddenError('Status notifikasi hanya untuk admin dan operator.');
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const dayStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - schoolMinutes(timezone, now) * 60_000);
    const counts = Object.fromEntries(NOTIFICATION_STATUSES.map((s) => [s, 0])) as NotificationOverview['counts'];
    for (const row of await countsSince(tx, dayStart)) counts[row.status] = row.count;
    const failed = await failedSince(tx, new Date(dayStart.getTime() - (NOTIFICATION_FAILED_DAYS - 1) * 24 * 60 * 60_000));
    return {
      schoolDate: schoolDate(timezone, now),
      counts,
      failed: failed.map((f) => ({
        id: f.id,
        templateCode: TemplateCode.parse(f.templateCode),
        recipient: maskPhone(f.toPhone.reveal()),
        studentName: f.studentName ? firstName(f.studentName) : null,
        attempts: f.attempts,
        lastError: f.lastError,
        createdAt: f.createdAt.toISOString(),
        failedAt: f.failedAt?.toISOString() ?? null,
      })),
    };
  });
}
