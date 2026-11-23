import { EARLY_WARNING_KINDS, FOLLOWUP_STATUSES, POINT_KINDS, UKS_OUTCOMES } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const uksOutcome = pgEnum('uks_outcome', UKS_OUTCOMES);
export const pointKind = pgEnum('point_kind', POINT_KINDS);
export const earlyWarningKind = pgEnum('early_warning_kind', EARLY_WARNING_KINDS);
export const followupStatus = pgEnum('followup_status', FOLLOWUP_STATUSES);

/**
 * Kesiswaan (KSW). UKS visits (KSW-08): insert-only, because a dipulangkan visit has already
 * marked attendance and told the parents. Complaint and action are encrypted (CLAUDE.md rule 9).
 */
export const uksVisits = pgTable(
  'uks_visits',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
    complaint: encryptedText('complaint', 'uks_visits.complaint').notNull(),
    action: encryptedText('action', 'uks_visits.action'),
    outcome: uksOutcome('outcome').notNull(),
    recordedBy: uuid('recorded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('uks_visits_school_id_school_date_idx').on(t.schoolId, t.schoolDate, t.visitedAt),
    index('uks_visits_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId, t.visitedAt),
  ],
);

/**
 * Point rules (KSW-01): one table per school. Pelanggaran are negative, prestasi positive (check),
 * switched off with active = false so entries keep pointing at them.
 */
export const pointRules = pgTable(
  'point_rules',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    kind: pointKind('kind').notNull(),
    category: text('category').notNull(),
    name: text('name').notNull(),
    points: smallint('points').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('point_rules_school_id_name_key').on(t.schoolId, sql`lower(${t.name})`),
    check('point_rules_points_check', sql`(${t.kind} = 'violation' and ${t.points} between -100 and -1) or (${t.kind} = 'achievement' and ${t.points} between 1 and 100)`),
  ],
);

/**
 * Point entries (KSW-02): insert-only. Rule title, category and points are copied so later edits to
 * the rule never rewrite history; a mistake is undone by a reversing entry (negated points, same kind,
 * reverses_entry_id set), at most one per entry. The note is encrypted.
 */
export const pointEntries = pgTable(
  'point_entries',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => pointRules.id, { onDelete: 'restrict' }),
    kind: pointKind('kind').notNull(),
    category: text('category').notNull(),
    ruleName: text('rule_name').notNull(),
    points: smallint('points').notNull(),
    occurredOn: date('occurred_on').notNull(),
    note: encryptedText('note', 'point_entries.note'),
    evidenceKey: text('evidence_key'),
    evidenceType: text('evidence_type'),
    reversesEntryId: uuid('reverses_entry_id'),
    recordedBy: uuid('recorded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'point_entries_reverses_entry_id_fkey', columns: [t.reversesEntryId], foreignColumns: [t.id] }),
    index('point_entries_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId, t.occurredOn),
    uniqueIndex('point_entries_reverses_entry_id_key').on(t.reversesEntryId).where(sql`${t.reversesEntryId} is not null`),
    check('point_entries_points_check', sql`${t.points} between -100 and 100 and ${t.points} <> 0`),
    check(
      'point_entries_sign_check',
      sql`${t.reversesEntryId} is not null or (${t.kind} = 'violation' and ${t.points} < 0) or (${t.kind} = 'achievement' and ${t.points} > 0)`,
    ),
    check('point_entries_evidence_check', sql`(${t.evidenceKey} is null) = (${t.evidenceType} is null)`),
  ],
);

/** Point thresholds (KSW-03): tiers on the net pelanggaran points of a year. Switched off, never deleted: tasks cite them. */
export const pointThresholds = pgTable(
  'point_thresholds',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    minPoints: smallint('min_points').notNull(),
    label: text('label').notNull(),
    action: text('action').notNull(),
    notifyParents: boolean('notify_parents').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('point_thresholds_school_id_min_points_key').on(t.schoolId, t.minPoints),
    check('point_thresholds_min_points_check', sql`${t.minPoints} between 1 and 1000`),
  ],
);

/**
 * Follow-up tasks (KSW-03): one per tier per enrollment (so per student per year), made when a
 * pelanggaran takes the total across the tier. Label, action and points are copied from the tier.
 * Only the status moves, open to done, once.
 */
export const followupTasks = pgTable(
  'followup_tasks',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    thresholdId: uuid('threshold_id')
      .notNull()
      .references(() => pointThresholds.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    action: text('action').notNull(),
    minPoints: smallint('min_points').notNull(),
    totalPoints: smallint('total_points').notNull(),
    status: followupStatus('status').notNull().default('open'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => user.id, { onDelete: 'set null' }),
    note: encryptedText('note', 'followup_tasks.note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('followup_tasks_enrollment_id_threshold_id_key').on(t.enrollmentId, t.thresholdId),
    index('followup_tasks_school_id_status_idx').on(t.schoolId, t.status, t.createdAt),
    check('followup_tasks_done_check', sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
  ],
);

/**
 * Early warnings (KSW-04): one row per student per pattern per school date, made by ksw.early-warning.
 * Insert-only: a warning is a record of what the job saw that evening.
 */
export const earlyWarnings = pgTable(
  'early_warnings',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    kind: earlyWarningKind('kind').notNull(),
    schoolDate: date('school_date').notNull(),
    dates: date('dates').array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('early_warnings_enrollment_id_kind_school_date_key').on(t.enrollmentId, t.kind, t.schoolDate),
    index('early_warnings_school_id_school_date_idx').on(t.schoolId, t.schoolDate),
  ],
);

/** Marks the school days the job has handled, so a 5-minute cron after 18.00 runs once a day per school. */
export const earlyWarningRuns = pgTable(
  'early_warning_runs',
  {
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.schoolId, t.schoolDate] })],
);
