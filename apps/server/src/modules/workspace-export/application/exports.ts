import { WORKSPACE_EXPORT_RETENTION_DAYS, type CreateWorkspaceExportRequest, type WorkspaceExport, type WorkspaceExportDownload, type WorkspaceExportList } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canExportWorkspace } from '../domain/policies';
import { findExport, insertExport, isTppkMember, listExports as listRows, type WorkspaceExportRow } from '../infrastructure/export-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
export const WORKSPACE_EXPORT_CONTENT_TYPE = 'application/zip';

export function viewExport(row: WorkspaceExportRow): WorkspaceExport {
  return {
    id: row.id,
    status: row.status,
    includeFiles: row.includeFiles,
    includesTppk: row.includeTppk,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    tables: row.tableCount,
    files: row.fileCount,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * PLT-11: queue a workspace export. Admin only, one waiting at a time per school (a second ask is 409 already_queued).
 * Whether the tppk schema goes in is fixed now: only when the admin is also on the TPPK team.
 */
export async function requestWorkspaceExport(actor: Actor, auditCtx: AuditContext, input: CreateWorkspaceExportRequest): Promise<WorkspaceExport> {
  authorize(actor, canExportWorkspace);
  try {
    return await withTenant(scope(actor), async (tx) => {
      const id = uuidv7();
      const includeTppk = await isTppkMember(tx, actor.userId);
      await insertExport(tx, { id, schoolId: actor.schoolId, includeFiles: input.includeFiles, includeTppk, fileKey: storageKey(actor.schoolId, 'workspace_exports', id), requestedBy: actor.userId });
      await audit(tx, auditCtx, 'workspace_export.requested', { type: 'workspace_export', id }, { after: { includeFiles: input.includeFiles, includeTppk } });
      await emit(tx, 'workspace_export.requested', { workspaceExportId: id });
      const row = await findExport(tx, id);
      if (!row) throw new Error('workspace export vanished');
      return viewExport(row);
    });
  } catch (err) {
    if (isUniqueViolation(err, 'workspace_exports_one_queued_key')) throw new ConflictError('Masih ada ekspor yang sedang dibuat. Tunggu sampai selesai.', { reason: 'already_queued' });
    throw err;
  }
}

export function listWorkspaceExports(actor: Actor): Promise<WorkspaceExportList> {
  authorize(actor, canExportWorkspace);
  return withTenant(scope(actor), async (tx) => ({ items: (await listRows(tx)).map(viewExport) }));
}

export function getWorkspaceExport(actor: Actor, id: string): Promise<WorkspaceExport> {
  authorize(actor, canExportWorkspace);
  return withTenant(scope(actor), async (tx) => {
    const row = await findExport(tx, id);
    if (!row) throw new NotFoundError('Ekspor tidak ditemukan.');
    return viewExport(row);
  });
}

/** A presigned 5-minute link; every download is audited (the file holds the whole school). */
export function downloadWorkspaceExport(actor: Actor, auditCtx: AuditContext, id: string, storage: ObjectStorage): Promise<WorkspaceExportDownload> {
  authorize(actor, canExportWorkspace);
  return withTenant(scope(actor), async (tx) => {
    const row = await findExport(tx, id);
    if (!row) throw new NotFoundError('Ekspor tidak ditemukan.');
    if (row.status === 'expired') throw new ConflictError(`Berkas sudah dihapus setelah ${WORKSPACE_EXPORT_RETENTION_DAYS} hari. Buat ekspor baru.`, { reason: 'expired' });
    if (row.status !== 'done' || !row.fileName) throw new ConflictError('Berkas belum siap.', { reason: 'not_ready' });
    const link = await storage.presignDownload({ key: row.fileKey, contentType: WORKSPACE_EXPORT_CONTENT_TYPE, fileName: row.fileName });
    await audit(tx, auditCtx, 'workspace_export.downloaded', { type: 'workspace_export', id });
    return { url: link.url, fileName: row.fileName, expiresAt: link.expiresAt.toISOString() };
  });
}
