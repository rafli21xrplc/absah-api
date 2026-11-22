import { z } from 'zod';
import { EXPORT_STATUSES } from '../report/exports';

/** PLT-11: the school's right to take its data along. A ZIP of one CSV per table plus the school's own files, built by the worker. */

/** The file holds every student's data: removed this many days after it is made. */
export const WORKSPACE_EXPORT_RETENTION_DAYS = 7;

/** Only the admin of the school asks; the answer is 202 with a queued job, one at a time per school. */
export const CreateWorkspaceExportRequest = z
  .object({
    /** false: tables only, without the uploaded files (photos, izin attachments, imports). */
    includeFiles: z.boolean().default(true),
  })
  .strict()
  .meta({ id: 'CreateWorkspaceExportRequest' });
export type CreateWorkspaceExportRequest = z.infer<typeof CreateWorkspaceExportRequest>;

export const WorkspaceExport = z
  .object({
    id: z.uuid(),
    status: z.enum(EXPORT_STATUSES),
    includeFiles: z.boolean(),
    /** The tppk schema is in the file only when the person who asked is a TPPK member (it is not even the admin's to read otherwise). */
    includesTppk: z.boolean(),
    fileName: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    tables: z.number().int().nullable(),
    files: z.number().int().nullable(),
    /** Message for the admin when failed. */
    error: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'WorkspaceExport' });
export type WorkspaceExport = z.infer<typeof WorkspaceExport>;

export const WorkspaceExportList = z.object({ items: z.array(WorkspaceExport) }).meta({ id: 'WorkspaceExportList' });
export type WorkspaceExportList = z.infer<typeof WorkspaceExportList>;

export const WorkspaceExportIdParam = z.object({ exportId: z.uuid() });

export const WorkspaceExportDownload = z.object({ url: z.url(), fileName: z.string(), expiresAt: z.iso.datetime({ offset: true }) }).meta({ id: 'WorkspaceExportDownload' });
export type WorkspaceExportDownload = z.infer<typeof WorkspaceExportDownload>;
