import { ARRIVAL_OUTCOMES, CARD_HOLDERS, SCAN_METHODS, SCAN_REJECT_REASONS, SCAN_RESULTS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { date, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { enrollments, students } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const cardHolder = pgEnum('card_holder', CARD_HOLDERS);
export const scanMethod = pgEnum('scan_method', SCAN_METHODS);
export const scanResult = pgEnum('scan_result', SCAN_RESULTS);
export const scanRejectReason = pgEnum('scan_reject_reason', SCAN_REJECT_REASONS);
export const arrivalOutcome = pgEnum('arrival_outcome', ARRIVAL_OUTCOMES);

const at = (name: string) => timestamp(name, { withTimezone: true });
const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });

/** The school's card secret (GRB-01); never leaves the server. Day keys are derived from it. */
export const gateSecrets = pgTable('gate_secrets', {
  schoolId: schoolRef().primaryKey(),
  secret: encryptedText('secret', 'gate_secrets.secret').notNull(),
  createdAt: createdAt(),
});

/** One digital card per student, shown on the holder's phone (card.holder: student or parent). */
export const cards = pgTable(
  'cards',
  {
    id: id(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** The bound phone; tokens from any other device id are refused. */
    activeDeviceId: uuid('active_device_id'),
    createdAt: createdAt(),
  },
  (t) => [unique('cards_student_id_key').on(t.studentId), index('cards_school_id_idx').on(t.schoolId)],
);

/** Phones a card was bound to; binding a new one ends the previous (revoked_at). */
export const cardDevices = pgTable(
  'card_devices',
  {
    id: id(),
    schoolId: schoolRef(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    holder: cardHolder('holder').notNull(),
    userId: userRef('user_id'),
    label: text('label'),
    createdAt: createdAt(),
    revokedAt: at('revoked_at'),
  },
  (t) => [index('card_devices_school_id_card_id_idx').on(t.schoolId, t.cardId)],
);

/** Kiosk devices at the gate; they authenticate with a device token (only its hash is stored). */
export const kioskDevices = pgTable(
  'kiosk_devices',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    lastSeenAt: at('last_seen_at'),
    lastQueueSize: integer('last_queue_size'),
    appVersion: text('app_version'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    revokedAt: at('revoked_at'),
  },
  (t) => [index('kiosk_devices_school_id_idx').on(t.schoolId)],
);

/** One-time pairing codes an admin creates for a new kiosk (10 minutes, single use). */
export const kioskPairings = pgTable(
  'kiosk_pairings',
  {
    id: id(),
    schoolId: schoolRef(),
    secretHash: text('secret_hash').notNull(),
    expiresAt: at('expires_at').notNull(),
    usedAt: at('used_at'),
    kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, { onDelete: 'set null' }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('kiosk_pairings_school_id_idx').on(t.schoolId)],
);

/**
 * Every scan a kiosk sent (and piket manual entries): accepted, duplicate or rejected, so a retried
 * batch gets the same answers (client_event_id is unique per kiosk). The first accepted scan of a
 * student per school date is the arrival that attendance marks (source gate).
 */
export const gateScans = pgTable(
  'gate_scans',
  {
    id: id(),
    schoolId: schoolRef(),
    schoolDate: date('school_date').notNull(),
    scannedAt: at('scanned_at').notNull(),
    method: scanMethod('method').notNull(),
    result: scanResult('result').notNull(),
    rejectReason: scanRejectReason('reject_reason'),
    outcome: arrivalOutcome('outcome'),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id'),
    kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, { onDelete: 'set null' }),
    clientEventId: uuid('client_event_id'),
    recordedBy: userRef('recorded_by'),
    /** Manual entries only (GRB-05): why the student had no card scan. */
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('gate_scans_kiosk_client_event_key').on(t.kioskDeviceId, t.clientEventId).where(sql`${t.clientEventId} is not null`),
    // At most one arrival per student per day.
    uniqueIndex('gate_scans_arrival_key').on(t.enrollmentId, t.schoolDate).where(sql`${t.result} = 'accepted'`),
    index('gate_scans_school_id_school_date_idx').on(t.schoolId, t.schoolDate),
  ],
);

/**
 * Buku tamu (GRB-11): one row per visit. clientEventId makes the kiosk's resend a no-op. The photo
 * (optional, photo_key) is removed 30 days after the guest left (photo_removed_at).
 */
export const visitors = pgTable(
  'visitors',
  {
    id: id(),
    schoolId: schoolRef(),
    schoolDate: date('school_date').notNull(),
    clientEventId: uuid('client_event_id').notNull(),
    kioskId: uuid('kiosk_id').references(() => kioskDevices.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    organization: text('organization'),
    purpose: text('purpose').notNull(),
    hostUserId: userRef('host_user_id'),
    photoKey: text('photo_key'),
    photoRemovedAt: at('photo_removed_at'),
    arrivedAt: at('arrived_at').notNull().defaultNow(),
    leftAt: at('left_at'),
    leftBy: userRef('left_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('visitors_school_id_client_event_id_key').on(t.schoolId, t.clientEventId),
    index('visitors_school_id_school_date_idx').on(t.schoolId, t.schoolDate, t.arrivedAt),
  ],
);
