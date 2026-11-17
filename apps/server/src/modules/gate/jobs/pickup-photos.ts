import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../shared/storage';
import { purgePickupPhotos } from '../application/pickup-guardians';

export const PICKUP_PHOTOS_QUEUE = 'gate.pickup_photos';

export function pickupPhotosHandler(storage: ObjectStorage, logger: Logger) {
  return async (): Promise<void> => {
    logger.info({ removed: await purgePickupPhotos(storage), queue: PICKUP_PHOTOS_QUEUE }, 'old pickup photos removed');
  };
}
