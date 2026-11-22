import { EXPORT_FORMATS, EXPORT_STATUSES, EXPORT_TARGETS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, pgEnum, pgTable, text, time, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { classes, classStream, semesters } from './academic';
import { user } from './auth';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

export const exportFormat = pgEnum('export_format', EXPORT_FORMATS);
export const exportTarget = pgEnum('export_target', EXPORT_TARGETS);
export const exportStatus = pgEnum('export_status', EXPORT_STATUSES);

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Rekap semester export (RKP-02, RKP-03). The worker builds the file into object storage under
 * file_key (schools/{id}/exports/{job id}); it is removed after EXPORT_RETENTION_DAYS.
 */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    target: exportTarget('target').notNull(),
    format: exportFormat('format').notNull(),
    semesterId: uuid('semester_id')
      .notNull()
      .references(() => semesters.id, { onDelete: 'cascade' }),
    /** null: every rombel of the semester's year. */
    classId: uuid('class_id').references(() => classes.id, { onDelete: 'cascade' }),
    /** AKD-11: only rombel of this jurusan (whole-year exports only). */
    stream: classStream('stream'),
    status: exportStatus('status').notNull().default('queued'),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name'),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    finishedAt: at('finished_at'),
  },
  (t) => [
    index('export_jobs_school_id_requested_by_idx').on(t.schoolId, t.requestedBy, t.createdAt),
    index('export_jobs_school_id_status_idx').on(t.schoolId, t.status, t.finishedAt),
  ],
);

/**
 * Workspace data export (PLT-11): a ZIP of one CSV per table plus the school's own files, built by the worker into object
 * storage under file_key (schools/{id}/workspace_exports/{id}); removed after WORKSPACE_EXPORT_RETENTION_DAYS. include_tppk is
 * decided when it is asked for (the requester is a TPPK member) and never widened later. One queued export per school.
 */
export const workspaceExports = pgTable(
  'workspace_exports',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    status: exportStatus('status').notNull().default('queued'),
    includeFiles: boolean('include_files').notNull().default(true),
    includeTppk: boolean('include_tppk').notNull().default(false),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    tableCount: integer('table_count'),
    fileCount: integer('file_count'),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    finishedAt: at('finished_at'),
  },
  (t) => [
    index('workspace_exports_school_id_created_at_idx').on(t.schoolId, t.createdAt),
    uniqueIndex('workspace_exports_one_queued_key').on(t.schoolId).where(sql`${t.status} = 'queued'`),
  ],
);

/**
 * Jumlah hadir MBG settings (RKP-08), one row per school. The PIC (meal coordinator) is not an
 * Absah account: name and WhatsApp number only.
 */
export const mbgSettings = pgTable(
  'mbg_settings',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    cutoffTime: time('cutoff_time').notNull().default('08:30'),
    picName: text('pic_name'),
    picPhone: encryptedText('pic_phone', 'mbg_settings.pic_phone'),
    updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('mbg_settings_school_id_key').on(t.schoolId)],
);

/**
 * Present students per rombel per school date (RKP-08). Rows are never changed (the app role has no
 * UPDATE or DELETE): the row stored at the cutoff is what the PIC received; a correction is a new
 * row whose supersedes_id points at the row it replaces. The current number of a rombel is the row
 * no other row supersedes. The H-3 forecast (RKP-09) lives in mbg_forecasts.
 */
export const mbgDailyCounts = pgTable(
  'mbg_daily_counts',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    enrolled: integer('enrolled').notNull(),
    presentAtCutoff: integer('present_at_cutoff').notNull(),
    /** Students without attendance at counting time (session not filled yet). */
    unrecorded: integer('unrecorded').notNull(),
    /** When the count was handed to the PIC message (same transaction); null without a PIC number. */
    sentAt: at('sent_at'),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => mbgDailyCounts.id, { onDelete: 'cascade' }),
    /** null: the cutoff job; otherwise who asked for the correction. */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('mbg_daily_counts_school_id_school_date_idx').on(t.schoolId, t.schoolDate, t.classId),
    // One cutoff row per rombel and day, and every row is superseded at most once (a chain).
    uniqueIndex('mbg_daily_counts_cutoff_key').on(t.schoolId, t.classId, t.schoolDate).where(sql`${t.supersedesId} is null`),
    uniqueIndex('mbg_daily_counts_supersedes_key').on(t.schoolId, t.supersedesId).where(sql`${t.supersedesId} is not null`),
  ],
);

/**
 * Prakiraan MBG H-3 (RKP-09) per rombel and target school date, computed once at 13.00 three
 * calendar days before: active students - approved izin - members of an off-campus activity that
 * day (a student in both counts once, as izin). Insert-only like mbg_daily_counts.
 */
export const mbgForecasts = pgTable(
  'mbg_forecasts',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    enrolled: integer('enrolled').notNull(),
    onLeave: integer('on_leave').notNull(),
    offCampus: integer('off_campus').notNull(),
    forecast: integer('forecast').notNull(),
    /** When it was handed to the PIC message (same transaction); null without a PIC number. */
    sentAt: at('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [unique('mbg_forecasts_class_date_key').on(t.schoolId, t.classId, t.schoolDate)],
);
