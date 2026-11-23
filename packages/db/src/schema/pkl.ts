import { TRACER_SOURCES, TRACER_STATUSES, PKL_CHECKIN_KINDS, PKL_CONFIRM_STATUSES, PKL_DEFAULT_RADIUS_M, PKL_JOURNAL_STATUSES, PKL_PLACEMENT_STATUSES, PKL_REVIEW_REASONS } from '@absah/contracts';
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { classStream, enrollments, students } from './academic';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const pklPlacementStatus = pgEnum('pkl_placement_status', PKL_PLACEMENT_STATUSES);
export const pklCheckinKind = pgEnum('pkl_checkin_kind', PKL_CHECKIN_KINDS);
export const pklConfirmStatus = pgEnum('pkl_confirm_status', PKL_CONFIRM_STATUSES);
export const pklReviewReason = pgEnum('pkl_review_reason', PKL_REVIEW_REASONS);
export const pklJournalStatus = pgEnum('pkl_journal_status', PKL_JOURNAL_STATUSES);
export const tracerStatus = pgEnum('tracer_status', TRACER_STATUSES);
export const tracerSource = pgEnum('tracer_source', TRACER_SOURCES);

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

/** Aspects the school grades PKL students on (PKL-04). Retired aspects stay: assessments given keep their own copy of name and weight. */
export const pklAssessmentAspects = pgTable(
  'pkl_assessment_aspects',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    description: text('description'),
    weight: smallint('weight').notNull().default(1),
    position: smallint('position').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pkl_assessment_aspects_school_id_name_key').on(t.schoolId, sql`lower(${t.name})`).where(sql`${t.active}`),
    check('pkl_assessment_aspects_weight_check', sql`${t.weight} between 1 and 10`),
  ],
);

/** One assessment of one placement, given by its pembimbing industri (PKL-04). */
export const pklAssessments = pgTable(
  'pkl_assessments',
  {
    id: id(),
    schoolId: schoolRef(),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => pklPlacements.id, { onDelete: 'cascade' }),
    assessedBy: userRef('assessed_by'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('pkl_assessments_placement_id_key').on(t.placementId), index('pkl_assessments_school_id_idx').on(t.schoolId)],
);

/** A score per aspect, with the aspect's name and weight as they were when it was given. */
export const pklAssessmentScores = pgTable(
  'pkl_assessment_scores',
  {
    schoolId: schoolRef(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => pklAssessments.id, { onDelete: 'cascade' }),
    aspectId: uuid('aspect_id')
      .notNull()
      .references(() => pklAssessmentAspects.id, { onDelete: 'restrict' }),
    aspectName: text('aspect_name').notNull(),
    weight: smallint('weight').notNull(),
    score: smallint('score').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assessmentId, t.aspectId] }),
    index('pkl_assessment_scores_school_id_idx').on(t.schoolId),
    check('pkl_assessment_scores_score_check', sql`${t.score} between 0 and 100`),
  ],
);

/**
 * Alumni of the school for the tracer study (PKL-05). Not a student row: a graduate is no longer in any rombel, and the BKK may
 * add people who never were in Absah. student_id links the ones copied from a rombel. The WhatsApp number is encrypted.
 */
export const tracerAlumni = pgTable(
  'tracer_alumni',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    nisn: text('nisn'),
    graduationYear: smallint('graduation_year').notNull(),
    stream: classStream('stream'),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    phone: encryptedText('phone', 'tracer_alumni.phone'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tracer_alumni_school_id_student_id_key').on(t.schoolId, t.studentId).where(sql`${t.studentId} is not null`),
    index('tracer_alumni_school_id_year_idx').on(t.schoolId, t.graduationYear),
    check('tracer_alumni_year_check', sql`${t.graduationYear} between 1990 and 2100`),
  ],
);

/** The answer of one alumnus (one row, replaced when answered again). organization and position are encrypted: where a person works is personal data. */
export const tracerResponses = pgTable(
  'tracer_responses',
  {
    id: id(),
    schoolId: schoolRef(),
    alumnusId: uuid('alumnus_id')
      .notNull()
      .references(() => tracerAlumni.id, { onDelete: 'cascade' }),
    status: tracerStatus('status').notNull(),
    organization: encryptedText('organization', 'tracer_responses.organization'),
    position: encryptedText('position', 'tracer_responses.position'),
    source: tracerSource('source').notNull(),
    enteredBy: userRef('entered_by'),
    answeredAt: at('answered_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('tracer_responses_alumnus_id_key').on(t.alumnusId), index('tracer_responses_school_id_idx').on(t.schoolId)],
);


/**
 * The link an alumnus gets over WhatsApp to answer the tracer study without an account (PKL-05). Only the HMAC of the secret is
 * stored; it is valid for TRACER_LINK_DAYS and the alumnus may change the answer until then. The BKK's invitation may mint a new one.
 */
export const tracerLinks = pgTable(
  'tracer_links',
  {
    id: id(),
    schoolId: schoolRef(),
    alumnusId: uuid('alumnus_id')
      .notNull()
      .references(() => tracerAlumni.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: at('expires_at').notNull(),
    lastOpenedAt: at('last_opened_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tracer_links_token_hash_key').on(t.tokenHash), index('tracer_links_school_id_alumnus_id_idx').on(t.schoolId, t.alumnusId)],
);
