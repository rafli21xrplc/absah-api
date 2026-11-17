import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../shared/storage';
import { purgeOldExports } from '../application/exports';

export const EXPORT_RETENTION_QUEUE = 'report.export_retention';

export function exportRetentionHandler(storage: ObjectStorage, logger: Logger) {
  return async (): Promise<void> => {
    logger.info({ expired: await purgeOldExports(storage), queue: EXPORT_RETENTION_QUEUE }, 'old export files removed');
  };
}
