import { z } from 'zod';
import { AttendanceSource, AttendanceStatus, SessionMode, SessionOwnerType, SessionStatus } from './enums';
import { SessionTopic } from './journal';

/** Attendance sessions: Hari ini, filling a session (PRS-01 to PRS-04). */

const Ref = z.object({ id: z.uuid(), name: z.string() });

export const SessionSummary = z
  .object({
    id: z.uuid(),
    schoolDate: z.iso.date(),
    mode: SessionMode,
    status: SessionStatus,
    owner: z.object({ type: SessionOwnerType, id: z.uuid(), name: z.string() }),
    /** Lesson time for per_period sessions. */
    period: z.object({ number: z.int(), startsAt: z.string(), endsAt: z.string() }).nullable(),
    subject: Ref.nullable(),
    teacher: Ref.nullable(),
    counts: z.object({ students: z.int(), filled: z.int(), absent: z.int() }),
    /** Jurnal mengajar topic; null until the teacher writes one. */
    topic: z.string().nullable(),
    /** The current user may fill this session (its teacher, the wali kelas, or a school manager). */
    canFill: z.boolean(),
  })
  .meta({ id: 'SessionSummary' });
export type SessionSummary = z.infer<typeof SessionSummary>;

/** GET /api/v1/attendance/today: scope=mine (default) or all (admin, operator, kepsek, wakasek, piket). */
export const TodayQuery = z.object({ scope: z.enum(['mine', 'all']).default('mine') }).meta({ id: 'TodayQuery' });
export type TodayQuery = z.infer<typeof TodayQuery>;

export const TodayResponse = z
  .object({ schoolDate: z.iso.date(), sessions: z.array(SessionSummary) })
  .meta({ id: 'TodayResponse' });
export type TodayResponse = z.infer<typeof TodayResponse>;

export const SessionStudent = z.object({
  enrollmentId: z.uuid(),
  studentId: z.uuid(),
  name: z.string(),
  /** Rombel of the student (learning group sessions mix rombel). */
  className: z.string(),
  status: AttendanceStatus.nullable(),
  source: AttendanceSource.nullable(),
  /** Set by a source the teacher cannot override (izin, UKS, correction): shown but not editable. */
  fixed: z.boolean(),
});

export const SessionDetail = SessionSummary.extend({ students: z.array(SessionStudent) }).meta({ id: 'SessionDetail' });
export type SessionDetail = z.infer<typeof SessionDetail>;

export const SessionIdParam = z.object({ sessionId: z.uuid() });

/**
 * POST /api/v1/sessions/{sessionId}/submit, "Semua hadir kecuali...": only the exceptions are sent;
 * everyone else on the roster becomes H. Can be sent again until the session locks at 23.59.
 */
export const SubmitSessionRequest = z
  .object({
    exceptions: z
      .array(z.object({ enrollmentId: z.uuid(), status: z.enum(['S', 'I', 'A', 'T']) }))
      .max(300),
    /** Jurnal mengajar (PRS-09): omit to keep the current topic, empty string to clear it. */
    topic: SessionTopic.optional(),
  })
  .strict()
  .meta({ id: 'SubmitSessionRequest' });
export type SubmitSessionRequest = z.infer<typeof SubmitSessionRequest>;
