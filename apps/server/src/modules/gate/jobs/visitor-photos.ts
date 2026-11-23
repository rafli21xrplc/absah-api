import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../shared/storage';
import { purgeVisitorPhotos } from '../application/visitors';

export const VISITOR_PHOTOS_QUEUE = 'gate.visitor_photos';

export function visitorPhotosHandler(storage: ObjectStorage, logger: Logger) {
  return async (): Promise<void> => {
    logger.info({ removed: await purgeVisitorPhotos(storage), queue: VISITOR_PHOTOS_QUEUE }, 'old visitor photos removed');
  };
}
