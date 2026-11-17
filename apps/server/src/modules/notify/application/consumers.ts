import type { LeaveKind } from '@absah/contracts';
import { defineConsumer, type Consumer } from '../../../shared/outbox';
import { firstName } from '../../../shared/names';
import type { MessageSender } from '../../../shared/messaging';
import { schoolMinutes } from '../../../shared/school-date';
import { clockLabel, dateLabel, dateRangeLabel, mbgClassesLine, releaseTime } from '../domain/messages';
import {
  guardiansOf,
  homeroomContact,
  leaveOf,
  liaisonNotice,
  liaisonWindow,
  mbgCurrentCounts,
  mbgPicPhone,
  portalGuardians,
  schoolOf,
  sentHomeVisit,
  sessionDate,
  staffNames,
  tppkContacts,
} from '../infrastructure/notify-repo';
import { deliverConsumer } from './deliver';
import { queueMessages } from './queue';

const KIND_LABELS: Record<LeaveKind, string> = { sakit: 'sakit', izin: 'izin' };
const SENDER_LABELS: Record<string, string> = { orang_tua: 'orang tua', wali_kelas: 'wali kelas', guru: 'guru' };

export interface NotifyDeps {
  sender: MessageSender;
  /** Web origin; each message carries an action link there (ORT-01). */
  appUrl: string;
  /** Clock for quiet hours (tests). */
  now?: () => Date;
}

/**
 * Parents hear about alpa (one message per student per day, however many sessions) and about
 * decisions on izin. Only first name and status in the message; details behind the link.
 */
export function notifyConsumers(deps: NotifyDeps): Consumer[] {
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
        params: { school: school.name, first_name: firstName(guardians[0]?.studentName ?? ''), date: dateLabel(date) },
        appUrl: deps.appUrl,
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
          },
          appUrl: deps.appUrl,
          now: deps.now?.(),
        });
      },
    });

  /** RKP-08: one short message to the PIC MBG per count (cutoff or correction): total and per rombel. */
  const mbgCount = defineConsumer({
    name: 'notify_mbg_count',
    event: 'mbg.count_ready',
    async handle(tx, event) {
      const { schoolDate, correction } = event.payload;
      const [school, phone, rows] = await Promise.all([schoolOf(tx, event.schoolId), mbgPicPhone(tx), mbgCurrentCounts(tx, schoolDate)]);
      if (!school || !phone || rows.length === 0) return;
      await queueMessages(tx, {
        schoolId: event.schoolId,
        timezone: school.timezone,
        eventId: event.id,
        templateCode: correction ? 'mbg_count_corrected' : 'mbg_count',
        enrollmentId: null,
        recipients: [{ phone }],
        dedupKey: () => `mbg:${schoolDate}:${event.id}`,
        params: { school: school.name, date: dateLabel(schoolDate), total: String(rows.reduce((n, r) => n + r.present, 0)), classes: mbgClassesLine(rows) },
        appUrl: deps.appUrl,
        now: deps.now?.(),
      });
    },
  });

  /** KSW-08: parents hear that UKS sent their child home. First name and time only, never the complaint. */
  const sentHome = defineConsumer({
    name: 'notify_uks_sent_home',
    event: 'uks.sent_home',
    async handle(tx, event) {
      const visit = await sentHomeVisit(tx, event.payload.uksVisitId);
      if (!visit) return;
      const [school, guardians] = await Promise.all([schoolOf(tx, event.schoolId), guardiansOf(tx, visit.enrollmentId)]);
      if (!school || guardians.length === 0) return;
      await queueMessages(tx, {
        schoolId: event.schoolId,
        timezone: school.timezone,
        eventId: event.id,
        templateCode: 'student_sent_home',
        enrollmentId: visit.enrollmentId,
        recipients: guardians,
        dedupKey: (r) => `sent_home:${event.payload.uksVisitId}:${r.guardianId}`,
        params: { school: school.name, first_name: firstName(guardians[0]?.studentName ?? ''), time: clockLabel(schoolMinutes(school.timezone, visit.visitedAt)) },
        appUrl: deps.appUrl,
        now: deps.now?.(),
      });
    },
  });

  /**
   * KSW-06: a new TPPK report reaches the TPPK members only (never the kepsek or a wali kelas, in case
   * the report is about staff). The message says nothing about the report; the details are behind
   * login. Members without a WhatsApp number wait for staff push (NTF-06).
   */
  const tppkReport = defineConsumer({
    name: 'notify_tppk_report_received',
    event: 'tppk.report_received',
    async handle(tx, event) {
      const [school, contacts] = await Promise.all([schoolOf(tx, event.schoolId), tppkContacts(tx)]);
      if (!school || contacts.length === 0) return;
      const userOf = new Map(contacts.map((c) => [c.phone, c.userId]));
      await queueMessages(tx, {
        schoolId: event.schoolId,
        timezone: school.timezone,
        eventId: event.id,
        templateCode: 'tppk_report_received',
        enrollmentId: null,
        recipients: contacts.map((c) => ({ phone: c.phone })),
        dedupKey: (r) => `tppk_report:${event.payload.reportId}:${userOf.get(r.phone) ?? ''}`,
        params: { school: school.name, link: `${deps.appUrl}/tppk` },
        appUrl: deps.appUrl,
        now: deps.now?.(),
      });
    },
  });

  /** The team hears of every change to it, so no one is added (an admin included) without the others knowing. */
  const tppkTeam = defineConsumer({
    name: 'notify_tppk_team_changed',
    event: 'tppk.members_changed',
    async handle(tx, event) {
      const [school, contacts, added, removed] = await Promise.all([
        schoolOf(tx, event.schoolId),
        tppkContacts(tx),
        staffNames(tx, event.payload.added),
        staffNames(tx, event.payload.removed),
      ]);
      if (!school || contacts.length === 0) return;
      const userOf = new Map(contacts.map((c) => [c.phone, c.userId]));
      await queueMessages(tx, {
        schoolId: event.schoolId,
        timezone: school.timezone,
        eventId: event.id,
        templateCode: 'tppk_team_changed',
        enrollmentId: null,
        recipients: contacts.map((c) => ({ phone: c.phone })),
        dedupKey: (r) => `tppk_team:${event.id}:${userOf.get(r.phone) ?? ''}`,
        params: { school: school.name, added: added.join(', ') || '-', removed: removed.join(', ') || '-', link: `${deps.appUrl}/tppk` },
        appUrl: deps.appUrl,
        now: deps.now?.(),
      });
    },
  });

  /**
   * ORT-07: a parent's message reaches the wali kelas; a teacher's reaches the guardians who can sign
   * in. Outside the school's service hours it waits for the next start. At most one message per
   * recipient per thread per release hour, so a busy conversation is not a stream of WhatsApps.
   */
  const liaison = defineConsumer({
    name: 'notify_liaison_message',
    event: 'liaison.message_posted',
    async handle(tx, event) {
      const notice = await liaisonNotice(tx, event.payload.messageId);
      if (!notice) return;
      const [school, window] = await Promise.all([schoolOf(tx, event.schoolId), liaisonWindow(tx)]);
      if (!school) return;
      const fromParent = notice.senderRole === 'orang_tua';
      const homeroom = fromParent && notice.classId ? await homeroomContact(tx, notice.classId) : undefined;
      const people = fromParent ? (homeroom ? [homeroom] : []) : await portalGuardians(tx, notice.studentId);
      const recipients = people.filter((p) => p.userId !== notice.senderId);
      if (recipients.length === 0) return;
      const now = deps.now?.() ?? new Date();
      const hour = releaseTime(now, schoolMinutes(school.timezone, now), window).toISOString().slice(0, 13);
      const userOf = new Map(recipients.map((r) => [r.phone, r.userId]));
      await queueMessages(tx, {
        schoolId: event.schoolId,
        timezone: school.timezone,
        eventId: event.id,
        templateCode: 'liaison_message',
        enrollmentId: null,
        // Phones only: the reader signs in to the thread, so no action link is minted.
        recipients: recipients.map((r) => ({ phone: r.phone })),
        dedupKey: (r) => `liaison:${notice.threadId}:${userOf.get(r.phone) ?? ''}:${hour}`,
        params: {
          school: school.name,
          first_name: firstName(notice.studentName),
          sender: SENDER_LABELS[notice.senderRole] ?? 'sekolah',
          url: fromParent ? `${deps.appUrl}/penghubung/${notice.studentId}` : `${deps.appUrl}/portal/penghubung/${notice.studentId}`,
        },
        appUrl: deps.appUrl,
        now,
        window,
      });
    },
  });

  return [absent, leaveDecision('leave.approved'), leaveDecision('leave.rejected'), mbgCount, sentHome, tppkReport, tppkTeam, liaison, deliverConsumer(deps.sender)];
}
