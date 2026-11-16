import { z } from 'zod';

/** Student data import (AKD-03): upload -> parse job -> preview -> commit. */

export const IMPORT_SOURCES = ['dapodik', 'emis'] as const;
export const ImportSource = z.enum(IMPORT_SOURCES).meta({ id: 'ImportSource' });

export const IMPORT_STATUSES = ['awaiting_upload', 'parsing', 'ready', 'failed', 'committed'] as const;
export const ImportStatus = z.enum(IMPORT_STATUSES).meta({ id: 'ImportStatus' });
export type ImportStatus = z.infer<typeof ImportStatus>;

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** POST /api/v1/imports/dapodik (admin, operator). */
export const CreateImportRequest = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    fileSize: z.number().int().positive().max(IMPORT_MAX_BYTES, 'Berkas maksimal 10 MB.'),
    contentType: z.enum([XLSX_CONTENT_TYPE, 'application/octet-stream']),
  })
  .strict()
  .meta({ id: 'CreateImportRequest' });
export type CreateImportRequest = z.infer<typeof CreateImportRequest>;

export const PresignedUpload = z
  .object({
    url: z.url(),
    method: z.literal('PUT'),
    /** Send exactly these headers with the PUT. */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'PresignedUpload' });

export const ImportIdParam = z.object({ importId: z.uuid() });

export const ImportCounts = z
  .object({
    created: z.int(),
    changed: z.int(),
    unchanged: z.int(),
    missing: z.int(),
    rejected: z.int(),
    warnings: z.int(),
  })
  .meta({ id: 'ImportCounts' });
export type ImportCounts = z.infer<typeof ImportCounts>;

export const ImportFieldChange = z.object({
  field: z.enum(['name', 'nisn', 'nik', 'localId', 'gender', 'birthPlace', 'birthDate', 'className']),
  /** NIK is never shown: "tersimpan" or a masked value. */
  from: z.string().nullable(),
  to: z.string().nullable(),
});

/** One line of the preview. Unchanged students are only counted. */
export const ImportPreviewItem = z
  .object({
    kind: z.enum(['created', 'changed', 'missing', 'rejected']),
    /** Spreadsheet row; null for students missing from the file. */
    row: z.int().nullable(),
    name: z.string(),
    nisn: z.string().nullable(),
    className: z.string().nullable(),
    matchedBy: z.enum(['nisn', 'nik', 'name_birthdate']).nullable(),
    changes: z.array(ImportFieldChange),
    message: z.string().nullable(),
  })
  .meta({ id: 'ImportPreviewItem' });
export type ImportPreviewItem = z.infer<typeof ImportPreviewItem>;

export const ImportRowIssue = z
  .object({
    row: z.int(),
    field: z.string().nullable(),
    message: z.string(),
    severity: z.enum(['error', 'warning']),
  })
  .meta({ id: 'ImportRowIssue' });

export const StudentImportResponse = z
  .object({
    id: z.uuid(),
    source: ImportSource,
    status: ImportStatus,
    fileName: z.string(),
    /** Academic year the rombel and enrollments go into, e.g. "2026/2027". */
    academicYear: z.string().nullable(),
    /** Why parsing failed, for staff. */
    error: z.string().nullable(),
    counts: ImportCounts.nullable(),
    items: z.array(ImportPreviewItem),
    issues: z.array(ImportRowIssue),
    createdAt: z.iso.datetime(),
    committedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'StudentImportResponse' });
export type StudentImportResponse = z.infer<typeof StudentImportResponse>;

export const CreateImportResponse = z
  .object({ import: StudentImportResponse, upload: PresignedUpload })
  .meta({ id: 'CreateImportResponse' });

export const StudentImportList = z.object({ items: z.array(StudentImportResponse) }).meta({ id: 'StudentImportList' });
