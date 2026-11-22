import { defineConsumer, type Consumer } from '../../../shared/outbox';
import type { PushSender } from '../../../shared/push';
import { earlyWarningRecipients, leaveApprover, schoolOf, teacherLeaveDeciders, teacherLeaveOwner } from '../infrastructure/notify-repo';
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

  /** The early-warning job saw a pattern (KSW-04): the wali kelas and guru BK are told that one waits, not who. One tag, so a busy evening is one notification. */
  const earlyWarning = defineConsumer({
    name: 'notify_push_early_warning',
    event: 'ksw.early_warning_raised',
    async handle(tx, event) {
      const [school, recipients] = await Promise.all([schoolOf(tx, event.schoolId), earlyWarningRecipients(tx, event.payload.warningId)]);
      if (!school) return;
      for (const userId of recipients) await pushToUser(tx, deps.push, userId, { title: school.name, body: 'Ada peringatan dini kehadiran siswa. Ketuk untuk melihat.', url: '/peringatan-dini', tag: 'early-warning' });
    },
  });

  /** A teacher's izin waits for the wakasek (GRU-02). One tag, so several requests show as one notification. */
  const teacherLeaveRequested = defineConsumer({
    name: 'notify_push_teacher_leave_requested',
    event: 'teacher.leave_requested',
    async handle(tx, event) {
      const [school, deciders] = await Promise.all([schoolOf(tx, event.schoolId), teacherLeaveDeciders(tx, event.payload.teacherLeaveId)]);
      if (!school) return;
      for (const userId of deciders) await pushToUser(tx, deps.push, userId, { title: school.name, body: 'Ada izin guru yang menunggu persetujuan Anda.', url: '/izin-guru', tag: 'teacher-leave-approval' });
    },
  });

  /** The decision reaches the teacher; the text does not say which way, the screen does. */
  const teacherLeaveDecided = defineConsumer({
    name: 'notify_push_teacher_leave_decided',
    event: 'teacher.leave_decided',
    async handle(tx, event) {
      const [school, owner] = await Promise.all([schoolOf(tx, event.schoolId), teacherLeaveOwner(tx, event.payload.teacherLeaveId)]);
      if (!school || !owner) return;
      await pushToUser(tx, deps.push, owner, { title: school.name, body: 'Izin Anda sudah diputuskan. Ketuk untuk melihat.', url: '/izin-guru', tag: `teacher-leave:${event.payload.teacherLeaveId}` });
    },
  });

  /** A session was given to a substitute (GRU-03): the substitute is told, with a link to the session. The text names no class or teacher. */
  const substituteAssigned = defineConsumer({
    name: 'notify_push_substitute_assigned',
    event: 'teacher.substitute_assigned',
    async handle(tx, event) {
      const school = await schoolOf(tx, event.schoolId);
      if (!school) return;
      await pushToUser(tx, deps.push, event.payload.substituteId, { title: school.name, body: 'Anda ditugaskan menjadi guru pengganti. Ketuk untuk melihat.', url: `/sesi/${event.payload.sessionId}`, tag: `substitute:${event.payload.sessionId}` });
    },
  });

  return [visitorArrived, sessionUnfilled, leaveRequested, earlyWarning, teacherLeaveRequested, teacherLeaveDecided, substituteAssigned];
}
