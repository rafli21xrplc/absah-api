import type { TemplateCode } from '@absah/contracts';
import { sensitive, type Tx } from '@absah/db';
import { mintActionLink } from '../../../shared/action-links';
import { emit } from '../../../shared/outbox';
import { schoolMinutes } from '../../../shared/school-date';
import { releaseTime, type SendWindow } from '../domain/messages';
import { isMuted, windowFor } from '../domain/preferences';
import { insertNotifications, markReleased, preferencesOf, usedDedupKeys } from '../infrastructure/notify-repo';

/** A guardian of a student (gets an action link), or a contact outside the student data such as the PIC MBG. */
export type Recipient = { phone: string } & ({ guardianId: string; studentId: string } | { guardianId?: undefined; studentId?: undefined });

/**
 * Creates one notification per recipient (skipping dedup keys already used) and releases the
 * due ones at once with a notification.queued event; quiet-hour ones wait for the release job.
 * Each guardian gets an own action link (ORT-01) as the `link` param, minted only for new messages;
 * other recipients get none. A guardian's preferences (ORT-06) apply: a switched-off type is not
 * created at all, and "no late messages" ends their sending hours at the late cutoff.
 */
export async function queueMessages(
  tx: Tx,
  input: {
    schoolId: string;
    timezone: string;
    eventId: string;
    templateCode: TemplateCode;
    enrollmentId: string | null;
    recipients: Recipient[];
    dedupKey: (r: Recipient) => string;
    params: Record<string, string>;
    /** Web origin for the action link; the `link` param is filled per guardian. */
    appUrl: string;
    now?: Date;
    /** Narrower sending hours than the default (buku penghubung service hours). */
    window?: SendWindow;
  },
): Promise<number> {
  const now = input.now ?? new Date();
  const minutes = schoolMinutes(input.timezone, now);
  const [used, prefs] = await Promise.all([
    usedDedupKeys(tx, input.recipients.map(input.dedupKey)),
    preferencesOf(tx, input.recipients.flatMap((r) => (r.guardianId ? [r.guardianId] : []))),
  ]);
  const rows = [];
  for (const r of input.recipients.filter((x) => !used.has(input.dedupKey(x)))) {
    const pref = r.guardianId ? prefs.get(r.guardianId) : undefined;
    if (isMuted(pref, input.templateCode)) continue;
    const link = r.guardianId ? { link: await mintActionLink(tx, { schoolId: input.schoolId, guardianId: r.guardianId, studentId: r.studentId, appUrl: input.appUrl, now }) } : {};
    rows.push({
      schoolId: input.schoolId,
      dedupKey: input.dedupKey(r),
      eventId: input.eventId,
      guardianId: r.guardianId ?? null,
      enrollmentId: input.enrollmentId,
      templateCode: input.templateCode,
      toPhone: sensitive(r.phone),
      params: sensitive(JSON.stringify({ ...input.params, ...link })),
      scheduledFor: releaseTime(now, minutes, windowFor(input.window, pref)),
    });
  }
  const created = await insertNotifications(tx, rows);
  const due = created.filter((c) => c.scheduledFor <= now).map((c) => c.id);
  await markReleased(tx, due, now);
  for (const notificationId of due) await emit(tx, 'notification.queued', { notificationId });
  return created.length;
}
