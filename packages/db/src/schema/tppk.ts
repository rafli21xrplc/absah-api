import { TPPK_CASE_STATUSES, TPPK_EVENT_KINDS, TPPK_REPORT_CATEGORIES, TPPK_REPORT_STATUSES, TPPK_REPORTER_RELATIONS } from '@absah/contracts';
import { boolean, date, index, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

/**
 * TPPK (KSW-06/07) lives in its own schema. RLS (migration 0048): reports, cases and case_events are
 * readable only by users listed in tppk.members for that school; anyone may insert a report. Absah
 * support access never covers this schema. Free text is encrypted (CLAUDE.md rule 9).
 */
export const tppk = pgSchema('tppk');

const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const tppkReportCategory = tppk.enum('report_category', TPPK_REPORT_CATEGORIES);
export const tppkReportStatus = tppk.enum('report_status', TPPK_REPORT_STATUSES);
export const tppkReporterRelation = tppk.enum('reporter_relation', TPPK_REPORTER_RELATIONS);
export const tppkCaseStatus = tppk.enum('case_status', TPPK_CASE_STATUSES);
export const tppkEventKind = tppk.enum('event_kind', TPPK_EVENT_KINDS);

/** The school's TPPK, appointed by the admin. The source of truth for every tppk policy. */
export const tppkMembers = tppk.table(
  'members',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    appointedBy: uuid('appointed_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [unique('tppk_members_school_id_user_id_key').on(t.schoolId, t.userId)],
);

/**
 * One report. Anonymous: reporter_user_id, name and contact are null and no IP is kept anywhere.
 * Only the HMAC of the tracking code is stored; the code itself is shown to the reporter once.
 */
export const tppkReports = tppk.table(
  'reports',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    category: tppkReportCategory('category').notNull(),
    chronology: encryptedText('chronology', 'tppk.reports.chronology').notNull(),
    occurredOn: date('occurred_on'),
    reporterRelation: tppkReporterRelation('reporter_relation').notNull(),
    isAnonymous: boolean('is_anonymous').notNull(),
    reporterUserId: uuid('reporter_user_id').references(() => user.id, { onDelete: 'set null' }),
    reporterName: encryptedText('reporter_name', 'tppk.reports.reporter_name'),
    reporterContact: encryptedText('reporter_contact', 'tppk.reports.reporter_contact'),
    trackingCodeHash: text('tracking_code_hash').notNull().unique('tppk_reports_tracking_code_hash_key'),
    status: tppkReportStatus('status').notNull().default('diterima'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tppk_reports_school_id_created_at_idx').on(t.schoolId, t.createdAt)],
);

/** Handling of a report by the team. One case per report at most. */
export const tppkCases = tppk.table(
  'cases',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .references(() => tppkReports.id, { onDelete: 'restrict' })
      .unique('tppk_cases_report_id_key'),
    summary: encryptedText('summary', 'tppk.cases.summary').notNull(),
    status: tppkCaseStatus('status').notNull().default('open'),
    openedBy: uuid('opened_by').references(() => user.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tppk_cases_school_id_status_idx').on(t.schoolId, t.status, t.createdAt)],
);

/** What the team did, in order. Insert-only: the record of handling is never rewritten. */
export const tppkCaseEvents = tppk.table(
  'case_events',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => tppkCases.id, { onDelete: 'cascade' }),
    kind: tppkEventKind('kind').notNull(),
    note: encryptedText('note', 'tppk.case_events.note').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('tppk_case_events_case_id_created_at_idx').on(t.caseId, t.createdAt)],
);
