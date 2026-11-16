import { keyedHash } from '@absah/db';
import path from 'node:path';
import type { Config } from '../config';
import { FsObjectStorage } from './fs-storage';
import type { ObjectStorage } from './object-storage';
import { R2ObjectStorage } from './r2-storage';

export * from './object-storage';
export { FsObjectStorage, fsUploadRouter } from './fs-storage';
export { R2ObjectStorage } from './r2-storage';

type StorageConfig = Pick<
  Config,
  'STORAGE_DRIVER' | 'STORAGE_FS_DIR' | 'R2_ACCOUNT_ID' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET' | 'BETTER_AUTH_URL' | 'HASH_KEY'
>;

export function createObjectStorage(config: StorageConfig): ObjectStorage {
  if (config.STORAGE_DRIVER === 'r2') {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = config;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) throw new Error('R2 storage is not configured');
    return new R2ObjectStorage({ accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET });
  }
  return new FsObjectStorage(path.resolve(config.STORAGE_FS_DIR), config.BETTER_AUTH_URL, keyedHash(config.HASH_KEY, 'storage.fs.presign'));
}
