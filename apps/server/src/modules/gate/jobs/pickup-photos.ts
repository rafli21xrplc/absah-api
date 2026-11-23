import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../shared/storage';
import { purgePickupPhotos } from '../application/pickup-guardians';
import { expireAndPurgeUnlisted } from '../application/unlisted-pickups';

export const PICKUP_PHOTOS_QUEUE = 'gate.pickup_photos';

export function pickupPhotosHandler(storage: ObjectStorage, logger: Logger) {
  return async (): Promise<void> => {
    const unlisted = await expireAndPurgeUnlisted(storage);
    logger.info({ removed: await purgePickupPhotos(storage), unlisted, queue: PICKUP_PHOTOS_QUEUE }, 'held pickups expired, old pickup photos removed');
  };
}
