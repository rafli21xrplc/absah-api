import { defineConsumer, type Consumer } from '../../../shared/outbox';
import type { PushSender } from '../../../shared/push';
import { leaveApprover, schoolOf } from '../infrastructure/notify-repo';
import { pushToUser } from './push';

/**
 * Staff Web Push (NTF-06). A push shows on a lock screen, so the text is generic: it says that
 * something waits, never who or about whom. The path in `url` leads to the screen that has the details.
 * Added to the worker only when VAPID is configured; a member who never enabled push gets nothing.
 */
export function pushConsumers(deps: { push: PushSender }): Consumer[] {
  /** A guest signed in at the kiosk and named this host. */
  const visitorArrived = defineConsumer({
    name: 'notify_push_visitor_arrived',
    event: 'gate.visitor_arrived',
    async handle(tx, event) {
      const school = await schoolOf(tx, event.schoolId);
      if (!school) return;
      await pushToUser(tx, deps.push, event.payload.hostUserId, { title: school.name, body: 'Ada tamu menunggu Anda di gerbang.', url: '/', tag: `visitor:${event.payload.visitorId}` });
    },
  });

  /** The reminder after a session was not filled: the teacher (or wali kelas, for a daily session). */
  const sessionUnfilled = defineConsumer({
    name: 'notify_push_session_unfilled',
    event: 'attendance.session_unfilled',
    async handle(tx, event) {
      const school = await schoolOf(tx, event.schoolId);
      if (!school) return;
      await pushToUser(tx, deps.push, event.payload.teacherId, { title: school.name, body: 'Presensi belum diisi. Ketuk untuk mengisi.', url: `/sesi/${event.payload.sessionId}`, tag: `session:${event.payload.sessionId}` });
    },
  });

  /** A parent's izin waits for the wali kelas. One tag, so several requests show as one notification. */
  const leaveRequested = defineConsumer({
    name: 'notify_push_leave_requested',
    event: 'leave.requested',
    async handle(tx, event) {
      const [school, approver] = await Promise.all([schoolOf(tx, event.schoolId), leaveApprover(tx, event.payload.leaveRequestId)]);
      if (!school || !approver) return;
      await pushToUser(tx, deps.push, approver, { title: school.name, body: 'Ada izin siswa yang menunggu persetujuan Anda.', url: '/izin', tag: 'leave-approval' });
    },
  });

  return [visitorArrived, sessionUnfilled, leaveRequested];
}
