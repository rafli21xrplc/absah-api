import type { LeaveKind } from '@absah/contracts';
import { defineConsumer, type Consumer } from '../../../shared/outbox';
import { firstName } from '../../../shared/names';
import type { MessageSender } from '../../../shared/messaging';
import { dateLabel, dateRangeLabel } from '../domain/messages';
import { guardiansOf, leaveOf, schoolOf, sessionDate } from '../infrastructure/notify-repo';
import { deliverConsumer } from './deliver';
import { queueMessages } from './queue';

const KIND_LABELS: Record<LeaveKind, string> = { sakit: 'sakit', izin: 'izin' };

export interface NotifyDeps {
  sender: MessageSender;
  /** Web origin; details open there. Prompt 3.3 replaces the portal link with a tokenized action link. */
  appUrl: string;
  /** Clock for quiet hours (tests). */
  now?: () => Date;
}

/**
 * Parents hear about alpa (one message per student per day, however many sessions) and about
 * decisions on izin. Only first name and status in the message; details behind the link.
 */
export function notifyConsumers(deps: NotifyDeps): Consumer[] {
  const link = `${deps.appUrl}/portal`;

  const absent = defineConsumer({
    name: 'notify_absent_marked',
    event: 'attendance.absent_marked',
    async handle(tx, event) {
      const [school, date, guardians] = await Promise.all([schoolOf(tx, event.schoolId), sessionDate(tx, event.payload.sessionId), guardiansOf(tx, event.payload.enrollmentId)]);
      if (!school || !date || guardians.length === 0) return;
      await queueMessages(tx, {
        schoolId: event.schoolId,
        timezone: school.timezone,
        eventId: event.id,
        templateCode: 'absent_marked',
        enrollmentId: event.payload.enrollmentId,
        recipients: guardians,
        dedupKey: (r) => `absent:${event.payload.enrollmentId}:${date}:${r.guardianId}`,
        params: { school: school.name, first_name: firstName(guardians[0]?.studentName ?? ''), date: dateLabel(date), link },
        now: deps.now?.(),
      });
    },
  });

  const leaveDecision = (eventType: 'leave.approved' | 'leave.rejected') =>
    defineConsumer({
      name: eventType === 'leave.approved' ? 'notify_leave_approved' : 'notify_leave_rejected',
      event: eventType,
      async handle(tx, event) {
        const leave = await leaveOf(tx, event.payload.leaveRequestId);
        if (!leave) return;
        const [school, guardians] = await Promise.all([schoolOf(tx, event.schoolId), guardiansOf(tx, leave.enrollmentId)]);
        if (!school || guardians.length === 0) return;
        await queueMessages(tx, {
          schoolId: event.schoolId,
          timezone: school.timezone,
          eventId: event.id,
          templateCode: eventType === 'leave.approved' ? 'leave_approved' : 'leave_rejected',
          enrollmentId: leave.enrollmentId,
          recipients: guardians,
          dedupKey: (r) => `${eventType}:${event.payload.leaveRequestId}:${r.guardianId}`,
          params: {
            school: school.name,
            kind: KIND_LABELS[leave.kind],
            first_name: firstName(guardians[0]?.studentName ?? ''),
            dates: dateRangeLabel(leave.startsOn, leave.endsOn),
            link,
          },
          now: deps.now?.(),
        });
      },
    });

  return [absent, leaveDecision('leave.approved'), leaveDecision('leave.rejected'), deliverConsumer(deps.sender)];
}
