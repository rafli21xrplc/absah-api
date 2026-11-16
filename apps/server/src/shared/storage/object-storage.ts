/**
 * File storage behind an interface (R2 in production, the local filesystem in dev and tests).
 * Browsers upload straight to storage with a short-lived presigned PUT; the API never streams
 * uploads through request handlers. Keys: schools/{school_id}/{module}/{uuid}.
 */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client must send with the PUT (signed). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectStorage {
  presignUpload(input: { key: string; contentType: string; contentLength: number }): Promise<PresignedUpload>;
  /** null when the object does not exist (not uploaded yet). */
  read(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

/** Presigned URLs live 5 minutes (docs/architecture.md "Isolasi tenant dan data sensitif"). */
export const PRESIGN_TTL_SECONDS = 300;

const KEY = /^schools\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}$/;

export function storageKey(schoolId: string, module: string, id: string): string {
  const key = `schools/${schoolId}/${module}/${id}`;
  if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
  return key;
}

export function assertStorageKey(key: string): void {
  if (!KEY.test(key)) throw new Error('invalid storage key');
}
