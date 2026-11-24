import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../shared/storage';
import { purgeOldWorkspaceExports } from '../application/consumer';

export const WORKSPACE_EXPORT_RETENTION_QUEUE = 'workspace_export.retention';

export function workspaceExportRetentionHandler(storage: ObjectStorage, logger: Logger) {
  return async (): Promise<void> => {
    logger.info({ expired: await purgeOldWorkspaceExports(storage), queue: WORKSPACE_EXPORT_RETENTION_QUEUE }, 'old workspace exports removed');
  };
}
