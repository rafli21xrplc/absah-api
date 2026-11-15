import { customType } from 'drizzle-orm/pg-core';
import { decryptWith, encryptWith, rotateWith, SensitiveText, type Keyring } from './keyring';

export * from './keyring';

let keyring: Keyring | undefined;

/** Called once at process start (http, worker, scripts, tests). */
export function configureEncryption(value: Keyring): void {
  keyring = value;
}

function current(): Keyring {
  if (!keyring) throw new Error('Column encryption is not configured; call configureEncryption() at startup');
  return keyring;
}

export const encrypt = (plaintext: string, context: string) => encryptWith(current(), plaintext, context);
export const decrypt = (ciphertext: string, context: string) => decryptWith(current(), ciphertext, context);
export const rotate = (ciphertext: string, context: string) => rotateWith(current(), ciphertext, context);

/**
 * Encrypted text column. `context` must be unique per column ("<table>.<column>") and must never
 * change once data exists, because it is the AAD.
 */
export function encryptedText(name: string, context: string) {
  return customType<{ data: SensitiveText; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => encrypt(value.reveal(), context),
    fromDriver: (value) => new SensitiveText(decrypt(value, context)),
  })(name);
}
