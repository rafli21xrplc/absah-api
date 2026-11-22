import { MembershipStatus } from '@absah/contracts';
import { z } from 'zod';

/**
 * Catalog of outbox events. Payloads carry ids and states, never personal data (names, phones):
 * consumers load what they need inside their own withTenant transaction.
 * Changing a payload shape is a breaking change for queued jobs: add a new event type instead.
 */
export const EVENTS = {
  'membership.status_changed': z.object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    from: MembershipStatus,
    to: MembershipStatus,
  }),
  /** Delivery of the link over WhatsApp/email arrives with notifications (prompt 3.2). */
  'membership.invited': z.object({
    membershipId: z.uuid(),
    invitationId: z.uuid(),
    channel: z.enum(['email', 'whatsapp']),
  }),
  /** The file of a student import is uploaded; academic parses it into a preview. */
  'student_import.uploaded': z.object({ importId: z.uuid() }),
  /** A session is still open 10 minutes after its lesson ended; notify reminds the teacher (3.2). */
  'attendance.session_unfilled': z.object({ sessionId: z.uuid(), teacherId: z.uuid() }),
  /** A student is newly alpa in a session; notify tells the parents (3.2), KSW counts it (5.8). */
  'attendance.absent_marked': z.object({ sessionId: z.uuid(), enrollmentId: z.uuid() }),
  /** All sessions of a school date are locked and daily_attendance is final (one event per day). */
  'attendance.session_locked': z.object({ schoolDate: z.iso.date(), sessions: z.int(), missed: z.int() }),
  /** A parent asked for izin; notify tells the wali kelas (3.2). */
  'leave.requested': z.object({ leaveRequestId: z.uuid() }),
  /** Izin approved: attendance marks the sessions S/I (also ones created later), notify tells the parents. */
  'leave.approved': z.object({ leaveRequestId: z.uuid() }),
  /** Izin rejected: notify tells the parents (3.2). */
  'leave.rejected': z.object({ leaveRequestId: z.uuid() }),
  /** An approved izin was cancelled: attendance removes its marks, the next source shows again. */
  'leave.cancelled': z.object({ leaveRequestId: z.uuid() }),
  /** A rekap export was asked for; report builds the file in the worker (RKP-02, RKP-03). */
  'export.requested': z.object({ exportJobId: z.uuid() }),
  /** MBG numbers of a school date were stored (cutoff, or a correction); notify sends them to the PIC (RKP-08). */
  'mbg.count_ready': z.object({ schoolDate: z.iso.date(), correction: z.boolean() }),
  /** The H-3 forecast of a school date was stored (13.00, three days before); notify sends it to the PIC (RKP-09). */
  'mbg.forecast_ready': z.object({ schoolDate: z.iso.date() }),
  /** An admin asked to pay an invoice; subscription opens the VA/QRIS at the gateway in the worker (BIL). */
  'payment.requested': z.object({ paymentId: z.uuid() }),
  /** A parent or student asked to pay a student bill installment; student-billing opens the VA/QRIS at the gateway in the worker (TGH-03). */
  'student_payment.requested': z.object({ paymentId: z.uuid() }),
  /** A guest signed in at the kiosk for a staff member (GRB-11); the push to them arrives with NTF-06 (5.7). */
  'gate.visitor_arrived': z.object({ visitorId: z.uuid(), hostUserId: z.uuid() }),
  /** A student left with a penjemput (GRB-10): notify tells the parents who and when. */
  'gate.checked_out': z.object({ pickupEventId: z.uuid() }),
  /** The kiosk holds a student for an unlisted penjemput (GRB-10): notify asks the parents through the action link. */
  'gate.unlisted_pickup': z.object({ pickupEventId: z.uuid() }),
  /** UKS sent a student home (KSW-08): attendance marks the rest of the day S (source uks), notify tells the parents. */
  'uks.sent_home': z.object({ uksVisitId: z.uuid() }),
  /** An unpaid student bill installment is due within days (TGH-04): notify sends the parents one WhatsApp. */
  'student_bill.reminder_due': z.object({ installmentId: z.uuid() }),
  /** A pelanggaran took a student across a point threshold (KSW-03): a follow-up task was made; notify tells the parents when the tier asks for it. */
  'ksw.threshold_reached': z.object({ taskId: z.uuid() }),
  /** The early-warning job saw a pattern in a student's attendance (KSW-04): push to the wali kelas and guru BK. */
  'ksw.early_warning_raised': z.object({ warningId: z.uuid() }),
  /** A teacher asked for izin (GRU-02): push to the wakasek (kepsek and admin when the school has none). */
  'teacher.leave_requested': z.object({ teacherLeaveId: z.uuid() }),
  /** The wakasek decided a teacher's izin (GRU-02): push to the teacher. */
  'teacher.leave_decided': z.object({ teacherLeaveId: z.uuid(), approved: z.boolean() }),
  /** A session was given to a substitute (GRU-03): push to the substitute. */
  'teacher.substitute_assigned': z.object({ sessionId: z.uuid(), substituteId: z.uuid() }),
  /** A TPPK report came in (KSW-06): only the TPPK members are told, never the kepsek or wali kelas. */
  'tppk.report_received': z.object({ reportId: z.uuid() }),
  /** The admin changed the TPPK team (KSW-06): every member is told, so no one joins the team unseen. */
  'tppk.members_changed': z.object({ added: z.array(z.uuid()), removed: z.array(z.uuid()) }),
  /** A buku penghubung message was posted (ORT-07): notify tells the other side, held outside service hours. */
  'liaison.message_posted': z.object({ messageId: z.uuid() }),
  /** A user became the industry supervisor of PKL placements (PKL-01); notify sends them the /dudi login link. */
  'pkl.mentor_assigned': z.object({ userId: z.uuid() }),
  /** A student checked in or out at the DUDI (PKL-02). No consumer yet (daily summary for the industry supervisor later). */
  'pkl.checkin_recorded': z.object({ checkinId: z.uuid() }),
  /** A student has not checked in at the DUDI by 10.00 (PKL-02); notify reminds them over WhatsApp. */
  'pkl.checkin_missing': z.object({ sessionId: z.uuid() }),
  /** A notification is due; notify sends it (3 attempts, then failed). */
  'notification.queued': z.object({ notificationId: z.uuid() }),
} as const;

export type EventType = keyof typeof EVENTS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENTS)[T]>;

/** What a consumer receives (also the pg-boss job data). */
export interface OutboxEvent<T extends EventType = EventType> {
  id: string;
  schoolId: string;
  type: T;
  payload: EventPayload<T>;
  traceId: string | null;
  occurredAt: string;
}

const Envelope = z.object({
  id: z.uuid(),
  schoolId: z.uuid(),
  type: z.string(),
  payload: z.unknown(),
  traceId: z.string().nullable(),
  occurredAt: z.string(),
});

/** Validates job data coming back from pg-boss against the envelope and the event catalog. */
export function parseEvent<T extends EventType>(type: T, data: unknown): OutboxEvent<T> {
  const envelope = Envelope.parse(data);
  if (envelope.type !== type) throw new Error(`outbox: expected ${type}, got ${envelope.type}`);
  const payload = EVENTS[type].parse(envelope.payload) as EventPayload<T>;
  return { ...envelope, type, payload };
}
