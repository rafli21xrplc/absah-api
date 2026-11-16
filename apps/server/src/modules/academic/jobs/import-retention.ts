import { schema } from '@absah/db';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withPlatform } from '../../../shared/db';
import type { ObjectStorage } from '../../../shared/storage';

export const IMPORT_RETENTION_QUEUE = 'academic.import_retention';
const DAY = 24 * 60 * 60 * 1000;
/** Uploaded export files and unapplied previews hold children's data: kept 7 days at most. */
export const IMPORT_RETENTION_DAYS = 7;

/**
 * Across all schools (withPlatform): expires imports never committed within 7 days (file removed,
 * preview with NIKs dropped), and removes again the files of recent commits in case the removal
 * right after the commit failed (removal is idempotent).
 */
export async function purgeStaleImports(storage: ObjectStorage, now = new Date()): Promise<{ expired: number; filesRemoved: number }> {
  const t = schema.studentImports;
  const cutoff = new Date(now.getTime() - IMPORT_RETENTION_DAYS * DAY);
  const { stale, recent } = await withPlatform(async (tx) => {
    const staleRows = await tx
      .update(t)
      .set({ status: 'failed', error: 'Kedaluwarsa. Unggah ulang berkasnya.', preview: null, fingerprint: null })
      .where(and(inArray(t.status, ['awaiting_upload', 'parsing', 'ready', 'failed']), lt(t.createdAt, cutoff)))
      .returning({ fileKey: t.fileKey });
    const recentRows = await tx
      .select({ fileKey: t.fileKey })
      .from(t)
      .where(and(eq(t.status, 'committed'), gt(t.committedAt, new Date(now.getTime() - 2 * DAY))));
    return { stale: staleRows, recent: recentRows };
  });
  for (const r of [...stale, ...recent]) await storage.remove(r.fileKey);
  return { expired: stale.length, filesRemoved: stale.length + recent.length };
}

export function importRetentionHandler(storage: ObjectStorage, logger: Logger) {
  return async (): Promise<void> => {
    logger.info({ ...(await purgeStaleImports(storage)), queue: IMPORT_RETENTION_QUEUE }, 'stale student imports purged');
  };
}
