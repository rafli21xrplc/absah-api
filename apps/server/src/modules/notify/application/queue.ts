import type { TemplateCode } from '@absah/contracts';
import { sensitive, type Tx } from '@absah/db';
import { emit } from '../../../shared/outbox';
import { schoolMinutes } from '../../../shared/school-date';
import { releaseTime } from '../domain/messages';
import { insertNotifications, markReleased } from '../infrastructure/notify-repo';

export interface Recipient {
  guardianId: string;
  phone: string;
}

/**
 * Creates one notification per recipient (skipping dedup keys already used) and releases the
 * due ones at once with a notification.queued event; quiet-hour ones wait for the release job.
 */
export async function queueMessages(
  tx: Tx,
  input: {
    schoolId: string;
    timezone: string;
    eventId: string;
    templateCode: TemplateCode;
    enrollmentId: string;
    recipients: Recipient[];
    dedupKey: (r: Recipient) => string;
    params: Record<string, string>;
    now?: Date;
  },
): Promise<number> {
  const now = input.now ?? new Date();
  const scheduledFor = releaseTime(now, schoolMinutes(input.timezone, now));
  const created = await insertNotifications(
    tx,
    input.recipients.map((r) => ({
      schoolId: input.schoolId,
      dedupKey: input.dedupKey(r),
      eventId: input.eventId,
      guardianId: r.guardianId,
      enrollmentId: input.enrollmentId,
      templateCode: input.templateCode,
      toPhone: sensitive(r.phone),
      params: sensitive(JSON.stringify(input.params)),
      scheduledFor,
    })),
  );
  const due = created.filter((c) => c.scheduledFor <= now).map((c) => c.id);
  await markReleased(tx, due, now);
  for (const notificationId of due) await emit(tx, 'notification.queued', { notificationId });
  return created.length;
}
