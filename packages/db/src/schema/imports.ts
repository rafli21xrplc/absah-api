import { IMPORT_SOURCES, IMPORT_STATUSES, type ImportCounts } from '@absah/contracts';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

export const importSource = pgEnum('import_source', IMPORT_SOURCES);
export const importStatus = pgEnum('import_status', IMPORT_STATUSES);

/**
 * One student data import (AKD-03). The uploaded file lives in object storage under file_key.
 * preview holds the parsed rows (with NIK) and the preview lines, encrypted as one JSON document;
 * counts are plain so lists need no decryption. fingerprint detects data that changed between
 * preview and commit.
 */
export const studentImports = pgTable(
  'student_imports',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    source: importSource('source').notNull(),
    status: importStatus('status').notNull().default('awaiting_upload'),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    academicYear: text('academic_year'),
    error: text('error'),
    counts: jsonb('counts').$type<ImportCounts>(),
    preview: encryptedText('preview', 'student_imports.preview'),
    fingerprint: text('fingerprint'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    committedBy: uuid('committed_by'),
  },
  (t) => [index('student_imports_school_id_created_at_idx').on(t.schoolId, t.createdAt)],
);
