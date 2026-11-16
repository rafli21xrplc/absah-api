import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { guardians, students } from './academic';
import { cardDevices } from './gate';
import { leaveRequests } from './leave';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Tautan aksi (ORT-01): sent in a WhatsApp message to one guardian about one student. The token is
 * "<schoolId>.<secret>"; only the HMAC of the secret is stored. It lets the holder see the student's
 * day and card for 7 days and do one write (an izin request).
 */
export const actionLinks = pgTable(
  'action_links',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: at('expires_at').notNull(),
    lastOpenedAt: at('last_opened_at'),
    /** The one write the link allows; set together with the leave request it created. */
    writeUsedAt: at('write_used_at'),
    leaveRequestId: uuid('leave_request_id').references(() => leaveRequests.id, { onDelete: 'set null' }),
    /** The card device bound from this link, so reopening shows the same card instead of rebinding. */
    cardDeviceId: uuid('card_device_id').references(() => cardDevices.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('action_links_token_hash_key').on(t.tokenHash), index('action_links_school_id_expires_at_idx').on(t.schoolId, t.expiresAt)],
);
