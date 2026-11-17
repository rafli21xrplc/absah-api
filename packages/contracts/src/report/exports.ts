import { z } from 'zod';
import { ClassStream } from '../academic/enums';

/** Ekspor rekap semester (RKP-02, RKP-03): built by the worker, downloaded through a presigned URL. */

/** xlsx: the file the report system imports (e-Rapor, later RDM); pdf: the signed archive copy. */
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export const ExportFormat = z.enum(EXPORT_FORMATS).meta({ id: 'ExportFormat' });
export type ExportFormat = z.infer<typeof ExportFormat>;

/** Report system the file is shaped for; comes from the school's report.target capability. */
export const EXPORT_TARGETS = ['erapor', 'rdm'] as const;
export const ExportTarget = z.enum(EXPORT_TARGETS).meta({ id: 'ExportTarget' });
export type ExportTarget = z.infer<typeof ExportTarget>;

/** expired: the file was removed after EXPORT_RETENTION_DAYS; ask for a new export. */
export const EXPORT_STATUSES = ['queued', 'done', 'failed', 'expired'] as const;
export const ExportStatus = z.enum(EXPORT_STATUSES).meta({ id: 'ExportStatus' });
export type ExportStatus = z.infer<typeof ExportStatus>;

/** Finished files hold children's data: removed this many days after they are made. */
export const EXPORT_RETENTION_DAYS = 7;

/**
 * POST /api/v1/exports (Idempotency-Key): rekap semester of one rombel, or of every rombel of the
 * semester's year when classId is left out (managers only). Answers 202 with the queued job.
 */
export const CreateExportRequest = z
  .object({ format: ExportFormat, semesterId: z.uuid(), classId: z.uuid().optional(), stream: ClassStream.optional() })
  .strict()
  .refine((r) => !(r.classId && r.stream), { message: 'Pilih satu rombel atau satu jurusan.', path: ['stream'] })
  .meta({ id: 'CreateExportRequest' });
export type CreateExportRequest = z.infer<typeof CreateExportRequest>;

export const ExportJob = z
  .object({
    id: z.uuid(),
    target: ExportTarget,
    format: ExportFormat,
    semester: z.object({ id: z.uuid(), academicYear: z.string(), number: z.int() }),
    /** null: every rombel of the year. */
    class: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    /** AKD-11: every rombel of this jurusan; null with a class or for the whole year. */
    stream: ClassStream.nullable(),
    status: ExportStatus,
    fileName: z.string().nullable(),
    /** Message for staff when failed. */
    error: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'ExportJob' });
export type ExportJob = z.infer<typeof ExportJob>;

/** GET /api/v1/exports: the caller's own exports, newest first. */
export const ExportJobList = z.object({ items: z.array(ExportJob) }).meta({ id: 'ExportJobList' });
export type ExportJobList = z.infer<typeof ExportJobList>;

export const ExportIdParam = z.object({ exportId: z.uuid() });

/** GET /api/v1/exports/{exportId}/download: a 5-minute presigned GET that saves the file. */
export const ExportDownload = z
  .object({ url: z.url(), fileName: z.string(), expiresAt: z.iso.datetime() })
  .meta({ id: 'ExportDownload' });
export type ExportDownload = z.infer<typeof ExportDownload>;
