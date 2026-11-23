import { EXPORT_FORMATS, EXPORT_STATUSES, EXPORT_TARGETS } from '@absah/contracts';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { classes, semesters } from './academic';
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
