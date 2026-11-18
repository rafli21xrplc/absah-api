import { PKL_CHECKIN_KINDS, PKL_CONFIRM_STATUSES, PKL_DEFAULT_RADIUS_M, PKL_JOURNAL_STATUSES, PKL_PLACEMENT_STATUSES, PKL_REVIEW_REASONS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const pklPlacementStatus = pgEnum('pkl_placement_status', PKL_PLACEMENT_STATUSES);
export const pklCheckinKind = pgEnum('pkl_checkin_kind', PKL_CHECKIN_KINDS);
export const pklConfirmStatus = pgEnum('pkl_confirm_status', PKL_CONFIRM_STATUSES);
export const pklReviewReason = pgEnum('pkl_review_reason', PKL_REVIEW_REASONS);
export const pklJournalStatus = pgEnum('pkl_journal_status', PKL_JOURNAL_STATUSES);

const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });
const at = (name: string) => timestamp(name, { withTimezone: true });

/** Industry partner (DUDI, PKL-01). The point is precise; check-ins store only a rounded point. */
export const dudiPartners = pgTable(
  'dudi_partners',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    radiusM: integer('radius_m').notNull().default(PKL_DEFAULT_RADIUS_M),
    active: boolean('active').notNull().default(true),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('dudi_partners_school_id_name_key').on(t.schoolId, t.name),
    check('dudi_partners_latitude_check', sql`${t.latitude} between -90 and 90`),
    check('dudi_partners_longitude_check', sql`${t.longitude} between -180 and 180`),
    check('dudi_partners_radius_check', sql`${t.radiusM} between 25 and 2000`),
  ],
);

/** Working hours per ISO weekday (1 = Senin). No row = closed that day: no PKL session. */
export const dudiWorkHours = pgTable(
  'dudi_work_hours',
  {
    schoolId: schoolRef(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => dudiPartners.id, { onDelete: 'cascade' }),
    day: smallint('day').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.partnerId, t.day] }),
    index('dudi_work_hours_school_id_partner_id_idx').on(t.schoolId, t.partnerId),
    check('dudi_work_hours_day_check', sql`${t.day} between 1 and 7`),
    check('dudi_work_hours_range_check', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

/**
 * One student at one DUDI for a period (PKL-01). school_mentor_id = guru pembimbing (staff),
 * industry_mentor_id = pembimbing industri (phone account, OTP); null until the school names one.
 * Overlapping active placements of one enrollment are refused by the app under a lock.
 */
export const pklPlacements = pgTable(
  'pkl_placements',
  {
    id: id(),
    schoolId: schoolRef(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => dudiPartners.id, { onDelete: 'restrict' }),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    schoolMentorId: userRef('school_mentor_id'),
    industryMentorId: userRef('industry_mentor_id'),
    status: pklPlacementStatus('status').notNull().default('active'),
    cancelledAt: at('cancelled_at'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('pkl_placements_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId),
    index('pkl_placements_school_id_partner_id_idx').on(t.schoolId, t.partnerId),
    index('pkl_placements_school_id_school_mentor_id_idx').on(t.schoolId, t.schoolMentorId),
    index('pkl_placements_school_id_industry_mentor_id_idx').on(t.schoolId, t.industryMentorId),
    check('pkl_placements_dates_check', sql`${t.startsOn} <= ${t.endsOn}`),
  ],
);

/**
 * Check-in / check-out from the student's phone (PKL-02). Only taken when the student presses the
 * button (no background tracking). The point is rounded to 4 decimals (about 11 m); the industry
 * supervisor never sees it. One check-in and one check-out per placement per school date.
 * confirm_status is set on check-ins only.
 */
export const pklCheckins = pgTable(
  'pkl_checkins',
  {
    id: id(),
    schoolId: schoolRef(),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => pklPlacements.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    kind: pklCheckinKind('kind').notNull(),
    recordedAt: at('recorded_at').notNull().defaultNow(),
    deviceTime: at('device_time').notNull(),
    latitude: numeric('latitude', { precision: 6, scale: 4, mode: 'number' }).notNull(),
    longitude: numeric('longitude', { precision: 7, scale: 4, mode: 'number' }).notNull(),
    accuracyM: integer('accuracy_m'),
    distanceM: integer('distance_m').notNull(),
    reviewReasons: pklReviewReason('review_reasons').array().notNull().default(sql`'{}'`),
    /** Arrived after the DUDI opened: a confirmation records T instead of H. */
    late: boolean('late').notNull().default(false),
    confirmStatus: pklConfirmStatus('confirm_status'),
    confirmedAt: at('confirmed_at'),
    /** Null with confirmed_at set = pkl.auto-confirm. */
    confirmedBy: userRef('confirmed_by'),
    disputedAt: at('disputed_at'),
    disputedBy: userRef('disputed_by'),
    disputeReason: text('dispute_reason'),
    /** H/T/S/I/A as decided (text: attendance.ts imports this file for its FK, not the other way round). */
    decidedStatus: text('decided_status'),
    decidedAt: at('decided_at'),
    decidedBy: userRef('decided_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pkl_checkins_placement_id_school_date_kind_key').on(t.placementId, t.schoolDate, t.kind),
    index('pkl_checkins_school_id_school_date_idx').on(t.schoolId, t.schoolDate),
    index('pkl_checkins_school_id_confirm_status_idx').on(t.schoolId, t.confirmStatus),
    check('pkl_checkins_confirm_status_check', sql`(${t.kind} = 'in') = (${t.confirmStatus} is not null)`),
    check('pkl_checkins_decided_check', sql`(${t.confirmStatus} = 'decided') = (${t.decidedStatus} is not null)`),
    check('pkl_checkins_decided_status_check', sql`${t.decidedStatus} in ('H', 'S', 'I', 'A', 'T')`),
  ],
);

/** Daily PKL journal (PKL-03) with an optional attachment in R2 (schools/{id}/pkl/{uuid}). */
export const pklJournals = pgTable(
  'pkl_journals',
  {
    id: id(),
    schoolId: schoolRef(),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => pklPlacements.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    activity: text('activity').notNull(),
    competency: text('competency'),
    attachmentKey: text('attachment_key'),
    attachmentType: text('attachment_type'),
    status: pklJournalStatus('status').notNull().default('submitted'),
    reviewNote: text('review_note'),
    reviewedAt: at('reviewed_at'),
    reviewedBy: userRef('reviewed_by'),
    createdAt: createdAt(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('pkl_journals_placement_id_school_date_key').on(t.placementId, t.schoolDate),
    index('pkl_journals_school_id_school_date_idx').on(t.schoolId, t.schoolDate),
    check('pkl_journals_attachment_check', sql`(${t.attachmentKey} is null) = (${t.attachmentType} is null)`),
  ],
);
