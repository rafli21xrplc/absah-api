import { TEACHER_ATTENDANCE_SOURCES, TEACHER_LEAVE_KINDS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { attendanceSessions } from './attendance';
import { user } from './auth';
import { leaveStatus } from './leave';
import { schools } from './platform';

export const teacherAttendanceSource = pgEnum('teacher_attendance_source', TEACHER_ATTENDANCE_SOURCES);
export const teacherLeaveKind = pgEnum('teacher_leave_kind', TEACHER_LEAVE_KINDS);

const at = (name: string) => timestamp(name, { withTimezone: true });
const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });

/**
 * Teacher attendance (GRU-01): one row per teacher per school date, made by the first check-in. Only the check-out
 * time may change afterwards (column grant); `late` is decided once, at check-in, against that teacher's first
 * lesson of the day.
 */
export const teacherAttendance = pgTable(
  'teacher_attendance',
  {
    id: id(),
    schoolId: schoolRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    checkedInAt: at('checked_in_at').notNull(),
    checkedOutAt: at('checked_out_at'),
    late: boolean('late').notNull().default(false),
    source: teacherAttendanceSource('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('teacher_attendance_user_date_key').on(t.schoolId, t.userId, t.schoolDate),
    index('teacher_attendance_school_id_date_idx').on(t.schoolId, t.schoolDate),
    check('teacher_attendance_out_after_in_check', sql`${t.checkedOutAt} is null or ${t.checkedOutAt} >= ${t.checkedInAt}`),
  ],
);

/**
 * Izin guru (GRU-02). Same states as a student's izin; the wakasek decides. The reason may be medical, so it is
 * encrypted. Approved leave is what makes a teacher's sessions need a substitute (GRU-03).
 */
export const teacherLeaves = pgTable(
  'teacher_leaves',
  {
    id: id(),
    schoolId: schoolRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: teacherLeaveKind('kind').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    reason: encryptedText('reason', 'teacher_leaves.reason').notNull(),
    status: leaveStatus('status').notNull().default('pending'),
    decidedBy: userRef('decided_by'),
    decidedAt: at('decided_at'),
    decisionNote: text('decision_note'),
    cancelledAt: at('cancelled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('teacher_leaves_school_id_status_idx').on(t.schoolId, t.status),
    index('teacher_leaves_school_id_user_id_idx').on(t.schoolId, t.userId),
    // "Is this teacher away on that date" looks at approved leave only.
    index('teacher_leaves_school_id_approved_idx').on(t.schoolId, t.startsOn, t.endsOn).where(sql`${t.status} = 'approved'`),
    check('teacher_leaves_range_check', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * Substitutions (GRU-03), insert-only: who took a session over from whom, and who decided. The session's own
 * teacher_id moves to the substitute; this table is the history, including a second change of substitute.
 */
export const sessionSubstitutions = pgTable(
  'session_substitutions',
  {
    id: id(),
    schoolId: schoolRef(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    /** The teacher the session belonged to before this change (null if it had none). */
    fromTeacherId: userRef('from_teacher_id'),
    substituteId: uuid('substitute_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedBy: userRef('assigned_by'),
    createdAt: createdAt(),
  },
  (t) => [index('session_substitutions_school_id_session_id_idx').on(t.schoolId, t.sessionId), index('session_substitutions_school_id_substitute_id_idx').on(t.schoolId, t.substituteId, t.createdAt)],
);
