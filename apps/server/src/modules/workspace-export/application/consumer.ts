import { WORKSPACE_EXPORT_RETENTION_DAYS } from '@absah/contracts';
import { schoolDate } from '../../../shared/school-date';
import { withPlatform } from '../../../shared/db';
import { defineConsumer, type Consumer } from '../../../shared/outbox';
import type { ObjectStorage } from '../../../shared/storage';
import { expireExports, findExport, finishExport } from '../infrastructure/export-repo';
import { buildWorkspaceZip } from './build';

/** Worker: builds the ZIP into the export's file key and marks it done, or failed on the last try. */
export function workspaceExportConsumer(storage: ObjectStorage) {
  return defineConsumer({
    name: 'workspace_export_build',
    event: 'workspace_export.requested',
    retryLimit: 1,
    async handle(tx, event, delivery) {
      const job = await findExport(tx, event.payload.workspaceExportId, true);
      if (job?.status !== 'queued') return;
      try {
        // Savepoint: a database error inside still lets the last attempt record the failure.
        await tx.transaction(async (sp) => {
          const built = await buildWorkspaceZip({ schoolId: event.schoolId, requestedBy: job.requestedBy, includeFiles: job.includeFiles, includeTppk: job.includeTppk, storage });
          await storage.write(job.fileKey, built.zip, 'application/zip');
          await finishExport(sp, job.id, { status: 'done', fileName: `data-sekolah-${schoolDate('Asia/Jakarta')}.zip`, sizeBytes: built.zip.length, tableCount: built.tables, fileCount: built.files });
        });
      } catch (err) {
        if (!delivery.lastAttempt) throw err;
        await finishExport(tx, job.id, { status: 'failed', error: 'Berkas gagal dibuat. Coba minta ekspor lagi.' });
      }
    },
  });
}

export function workspaceExportConsumers(storage: ObjectStorage): Consumer[] {
  return [workspaceExportConsumer(storage)];
}

/** Removes finished exports after WORKSPACE_EXPORT_RETENTION_DAYS (withPlatform: maintenance across schools). */
export async function purgeOldWorkspaceExports(storage: ObjectStorage, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - WORKSPACE_EXPORT_RETENTION_DAYS * 86_400_000);
  const expired = await withPlatform((tx) => expireExports(tx, cutoff));
  for (const r of expired) await storage.remove(r.fileKey);
  return expired.length;
}
