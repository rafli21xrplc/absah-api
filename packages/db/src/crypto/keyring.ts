import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';

/**
 * Column encryption (PLT-05): AES-256-GCM with a key id in every ciphertext so keys can rotate.
 * Format: v1:<keyId>:<iv b64url>:<tag b64url>:<ciphertext b64url>
 * The AAD is the column identifier (e.g. "uks_visits.note"), so a ciphertext copied into another
 * column fails to decrypt.
 */
export interface Keyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID_RE = /^[a-z0-9_-]{1,32}$/i;
const VERSION = 'v1';

/** Parses ENCRYPTION_KEYS="k2:<base64 32 bytes>,k1:<base64 32 bytes>" and the active key id. */
export function parseKeyring(spec: string, activeKeyId: string): Keyring {
  const keys = new Map<string, Buffer>();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const sep = part.indexOf(':');
    const id = part.slice(0, sep);
    const key = Buffer.from(part.slice(sep + 1), 'base64');
    if (sep <= 0 || !KEY_ID_RE.test(id)) throw new Error('ENCRYPTION_KEYS: each entry must be <keyId>:<base64 key>');
    if (key.length !== 32) throw new Error(`ENCRYPTION_KEYS: key "${id}" must be 32 bytes (base64)`);
    if (keys.has(id)) throw new Error(`ENCRYPTION_KEYS: duplicate key id "${id}"`);
    keys.set(id, key);
  }
  if (!keys.has(activeKeyId)) throw new Error('ENCRYPTION_ACTIVE_KEY_ID must name a key in ENCRYPTION_KEYS');
  return { activeKeyId, keys };
}

export function encryptWith(keyring: Keyring, plaintext: string, context: string): string {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error('active encryption key missing');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, keyring.activeKeyId, b64(iv), b64(tag), b64(data)].join(':');
}

export function decryptWith(keyring: Keyring, ciphertext: string, context: string): string {
  const { keyId, iv, tag, data } = parse(ciphertext);
  const key = keyring.keys.get(keyId);
  // Message names the key id only; never the ciphertext or context value.
  if (!key) throw new Error(`decrypt: unknown key id "${keyId}"`);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('decrypt: authentication failed (wrong key, column or tampered value)');
  }
}

export function keyIdOf(ciphertext: string): string {
  return parse(ciphertext).keyId;
}

/** Re-encrypts with the active key when the value uses an older key; otherwise returns it unchanged. */
export function rotateWith(keyring: Keyring, ciphertext: string, context: string): string {
  if (keyIdOf(ciphertext) === keyring.activeKeyId) return ciphertext;
  return encryptWith(keyring, decryptWith(keyring, ciphertext, context), context);
}

function parse(ciphertext: string) {
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) throw new Error('decrypt: not an Absah ciphertext');
  const [, keyId = '', iv = '', tag = '', data = ''] = parts;
  return { keyId, iv: unb64(iv), tag: unb64(tag), data: unb64(data) };
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/** Keyed hash for values that must be matched but never read back (IP hashes, tracking codes). */
export function keyedHash(key: string, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

export function keyedHashEquals(key: string, value: string, expected: string): boolean {
  const a = Buffer.from(keyedHash(key, value));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Decrypted value of an encrypted column. Serialises as "[redacted]" in JSON, logs, string
 * concatenation and util.inspect; read it explicitly with reveal().
 */
export class SensitiveText {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return '[redacted]';
  }

  toString(): string {
    return '[redacted]';
  }

  [inspect.custom](): string {
    return 'SensitiveText([redacted])';
  }
}

export const sensitive = (value: string) => new SensitiveText(value);
