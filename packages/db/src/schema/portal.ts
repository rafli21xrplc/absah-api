import { LIAISON_SENDER_ROLES } from '@absah/contracts';
import { index, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { user } from './auth';
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

export const liaisonSenderRole = pgEnum('liaison_sender_role', LIAISON_SENDER_ROLES);

/**
 * Buku penghubung (ORT-07): one thread per student, across academic years. Participants are not
 * stored: they follow the data (guardians of the student, wali kelas and guru mapel of the active
 * enrollment), so a new wali kelas sees the history and a former one no longer does.
 */
export const communicationThreads = pgTable(
  'communication_threads',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    lastMessageAt: at('last_message_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('communication_threads_student_key').on(t.schoolId, t.studentId), index('communication_threads_last_message_idx').on(t.schoolId, t.lastMessageAt)],
);

/**
 * Messages. The sender may retract within 15 minutes; afterwards a message is permanent. A
 * retracted message keeps its body: participants see "ditarik", the admin sees the text (sengketa).
 */
export const communicationMessages = pgTable(
  'communication_messages',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => communicationThreads.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => user.id, { onDelete: 'set null' }),
    senderRole: liaisonSenderRole('sender_role').notNull(),
    body: encryptedText('body', 'communication_messages.body').notNull(),
    retractedAt: at('retracted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('communication_messages_thread_idx').on(t.threadId, t.createdAt)],
);

/** How far each participant has read a thread (unread counts). */
export const communicationReads = pgTable(
  'communication_reads',
  {
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => communicationThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    readAt: at('read_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })],
);
