// Column encryption and keyed hashing (PLT-05). Implementation lives in @absah/db so the Drizzle
// column type and the server share one keyring. Call initCrypto(config) at process start.
import { configureEncryption, keyedHash, parseKeyring } from '@absah/db';
import type { Config } from './config';

export { decrypt, encrypt, encryptedText, rotate, sensitive, SensitiveText } from '@absah/db';

let hashKey: string | undefined;

export function initCrypto(config: Pick<Config, 'ENCRYPTION_KEYS' | 'ENCRYPTION_ACTIVE_KEY_ID' | 'HASH_KEY'>): void {
  configureEncryption(parseKeyring(config.ENCRYPTION_KEYS, config.ENCRYPTION_ACTIVE_KEY_ID));
  hashKey = config.HASH_KEY;
}

/** HMAC-SHA256 with HASH_KEY: for values we match but never read back (IP, tracking codes). */
export function hashValue(value: string): string {
  if (!hashKey) throw new Error('Crypto not initialised; call initCrypto(config) at startup');
  return keyedHash(hashKey, value);
}
