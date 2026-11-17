import { ATTENDANCE_SOURCES, ATTENDANCE_STATUSES, CORRECTION_STATUSES, SESSION_MODES, SESSION_OWNER_TYPES, SESSION_STATUSES } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { date, index, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { enrollments } from './academic';
import { activities } from './activity';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';
import { scheduleSlots } from './schedule';

export const sessionMode = pgEnum('session_mode', SESSION_MODES);
export const sessionStatus = pgEnum('session_status', SESSION_STATUSES);
export const sessionOwnerType = pgEnum('session_owner_type', SESSION_OWNER_TYPES);
export const attendanceStatus = pgEnum('attendance_status', ATTENDANCE_STATUSES);
export const attendanceSource = pgEnum('attendance_source', ATTENDANCE_SOURCES);
export const correctionStatus = pgEnum('correction_status', CORRECTION_STATUSES);

const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });
const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One attendance session engine for every mode (CLAUDE.md rule 5). Sessions are generated per
 * school date; per_period sessions point at their schedule slot, daily sessions at the rombel.
 */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: id(),
    schoolId: schoolRef(),
    schoolDate: date('school_date').notNull(),
    mode: sessionMode('mode').notNull(),
    ownerType: sessionOwnerType('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    slotId: uuid('slot_id').references(() => scheduleSlots.id, { onDelete: 'set null' }),
    teacherId: userRef('teacher_id'),
    status: sessionStatus('status').notNull().default('open'),
    topic: text('topic'),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'restrict' }),
    pklPlacementId: uuid('pkl_placement_id'),
    submittedAt: at('submitted_at'),
    submittedBy: userRef('submitted_by'),
    remindedAt: at('reminded_at'),
    lockedAt: at('locked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('attendance_sessions_school_id_date_idx').on(t.schoolId, t.schoolDate),
    index('attendance_sessions_school_id_teacher_date_idx').on(t.schoolId, t.teacherId, t.schoolDate),
    // Generation is idempotent: one session per slot per day, one daily session per owner per day.
    uniqueIndex('attendance_sessions_slot_date_key').on(t.schoolId, t.schoolDate, t.slotId).where(sql`${t.slotId} is not null`),
    uniqueIndex('attendance_sessions_daily_owner_key')
      .on(t.schoolId, t.schoolDate, t.ownerType, t.ownerId)
      .where(sql`${t.mode} = 'daily'`),
  ],
);

/** The current status of one student in one session; the source decides which write wins. */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: id(),
    schoolId: schoolRef(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    status: attendanceStatus('status').notNull(),
    source: attendanceSource('source').notNull(),
    /** Leave request, gate scan, UKS visit, PKL check-in or correction request id. */
    sourceRef: uuid('source_ref'),
    recordedBy: userRef('recorded_by'),
    recordedAt: at('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    unique('attendance_records_session_enrollment_key').on(t.sessionId, t.enrollmentId),
    index('attendance_records_school_id_enrollment_idx').on(t.schoolId, t.enrollmentId),
  ],
);

/**
 * Every source's word on one student in one session (one row per source). attendance_records holds
 * the winner (resolveMarks); removing a mark, e.g. a cancelled izin, brings the next source back.
 */
export const attendanceMarks = pgTable(
  'attendance_marks',
  {
    schoolId: schoolRef(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    source: attendanceSource('source').notNull(),
    status: attendanceStatus('status').notNull(),
    sourceRef: uuid('source_ref'),
    recordedBy: userRef('recorded_by'),
    recordedAt: at('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.enrollmentId, t.source] }),
    index('attendance_marks_school_id_source_ref_idx').on(t.schoolId, t.sourceRef),
  ],
);

/** S/I/A rekap: one row per student per school date (RKP, MBG and e-Rapor read this). */
export const dailyAttendance = pgTable(
  'daily_attendance',
  {
    schoolId: schoolRef(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    status: attendanceStatus('status').notNull(),
    computedAt: at('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.enrollmentId, t.schoolDate] }),
    index('daily_attendance_school_id_date_idx').on(t.schoolId, t.schoolDate),
  ],
);

/** Changes to a locked session, applied only after a wakasek approves (PRS-05). */
export const correctionRequests = pgTable(
  'correction_requests',
  {
    id: id(),
    schoolId: schoolRef(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    fromStatus: attendanceStatus('from_status'),
    toStatus: attendanceStatus('to_status').notNull(),
    reason: text('reason').notNull(),
    status: correctionStatus('status').notNull().default('pending'),
    requestedBy: userRef('requested_by'),
    decidedBy: userRef('decided_by'),
    decidedAt: at('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('correction_requests_school_id_status_idx').on(t.schoolId, t.status),
    // One open request per student per session.
    uniqueIndex('correction_requests_pending_key').on(t.sessionId, t.enrollmentId).where(sql`${t.status} = 'pending'`),
  ],
);

/** Per school per date: when sessions were generated and when the day was locked (job markers). */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    schoolId: schoolRef(),
    schoolDate: date('school_date').notNull(),
    generatedAt: at('generated_at'),
    /** Set when no sessions were generated: 'holiday' or 'not_school_day'. */
    skippedReason: text('skipped_reason'),
    lockedAt: at('locked_at'),
  },
  (t) => [primaryKey({ columns: [t.schoolId, t.schoolDate] })],
);
