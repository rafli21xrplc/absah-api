import { LEAVE_KINDS, LEAVE_STATUSES } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const leaveKind = pgEnum('leave_kind', LEAVE_KINDS);
export const leaveStatus = pgEnum('leave_status', LEAVE_STATUSES);

const at = (name: string) => timestamp(name, { withTimezone: true });
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });

/**
 * Izin siswa (IZN). The reason may be medical, so it is encrypted. Approved requests are turned into
 * attendance marks (source leave) by the attendance module, also for sessions created later.
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    kind: leaveKind('kind').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    reason: encryptedText('reason', 'leave_requests.reason').notNull(),
    /** storageKey(school, 'leave', id) of the letter or photo, with the type it was uploaded as. */
    attachmentKey: text('attachment_key'),
    attachmentType: text('attachment_type'),
    status: leaveStatus('status').notNull().default('pending'),
    requestedBy: userRef('requested_by'),
    decidedBy: userRef('decided_by'),
    decidedAt: at('decided_at'),
    decisionNote: text('decision_note'),
    cancelledBy: userRef('cancelled_by'),
    cancelledAt: at('cancelled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('leave_requests_school_id_status_idx').on(t.schoolId, t.status),
    index('leave_requests_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId),
    // Session generation looks up approved requests covering a date.
    index('leave_requests_school_id_approved_idx').on(t.schoolId, t.startsOn, t.endsOn).where(sql`${t.status} = 'approved'`),
  ],
);
