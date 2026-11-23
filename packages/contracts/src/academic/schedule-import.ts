import { z } from 'zod';
import { PresignedUpload, XLSX_CONTENT_TYPE } from './imports';

/** Timetable import from the Absah Excel template (AKD-05). Stateless: preview, then commit. */

export const SCHEDULE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** POST /api/v1/schedule/imports: a presigned PUT for the filled template. */
export const CreateScheduleImportRequest = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    fileSize: z.int().positive().max(SCHEDULE_IMPORT_MAX_BYTES, 'Berkas maksimal 2 MB.'),
    contentType: z.enum([XLSX_CONTENT_TYPE, 'application/octet-stream']),
  })
  .strict()
  .meta({ id: 'CreateScheduleImportRequest' });
export type CreateScheduleImportRequest = z.infer<typeof CreateScheduleImportRequest>;

export const CreateScheduleImportResponse = z
  .object({ uploadId: z.uuid(), upload: PresignedUpload })
  .meta({ id: 'CreateScheduleImportResponse' });
export type CreateScheduleImportResponse = z.infer<typeof CreateScheduleImportResponse>;

export const UploadIdParam = z.object({ uploadId: z.uuid() });

/** POST /api/v1/schedule/imports/{uploadId}/preview: what a commit would do, nothing written. */
export const ScheduleImportPreview = z
  .object({
    lessons: z.int(),
    /** Rombel whose whole timetable the file replaces. */
    classes: z.array(z.string()),
    /** Subjects created on commit. */
    newSubjects: z.array(z.string()),
    /** Excel row numbers; commit is refused while any remain. */
    errors: z.array(z.object({ row: z.int(), message: z.string() })),
    /** Send back on commit; a changed file or school data makes the commit answer 409 stale_preview. */
    fingerprint: z.string(),
  })
  .meta({ id: 'ScheduleImportPreview' });
export type ScheduleImportPreview = z.infer<typeof ScheduleImportPreview>;

export const CommitScheduleImportRequest = z
  .object({ fingerprint: z.string().min(1) })
  .strict()
  .meta({ id: 'CommitScheduleImportRequest' });
export type CommitScheduleImportRequest = z.infer<typeof CommitScheduleImportRequest>;

export const ScheduleImportResult = z
  .object({ lessons: z.int(), classes: z.array(z.string()), newSubjects: z.array(z.string()) })
  .meta({ id: 'ScheduleImportResult' });
export type ScheduleImportResult = z.infer<typeof ScheduleImportResult>;
