/**
 * Dynamic card QR tokens (GRB-01), shared by the server, the kiosk and the card screen (portal/PWA).
 * Pure computation on WebCrypto (Node 22 and browsers); no I/O.
 *
 * Keys, each one HMAC-SHA256 step from the school secret (which only the server holds):
 *   schoolDayKey  = HMAC(schoolSecret, "absah-gate-day:" + schoolDate)   -> kiosks (offline check)
 *   deviceDayKey  = HMAC(schoolDayKey, "device:" + deviceId)              -> the holder's phone only
 *   mac           = HMAC(deviceDayKey, cardId + ":" + window)[0..16)
 * A window is 30 seconds. Only the bound phone can make tokens for its device id, so a token
 * pretending to come from another device fails; a screenshot expires within a minute.
 */

export const TOKEN_PREFIX = 'A1';
export const TOKEN_WINDOW_SECONDS = 30;
/** Accepted clock difference between phone and kiosk, in windows each way (about 1 minute). */
export const TOKEN_SKEW_WINDOWS = 2;

const enc = new TextEncoder();

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const uuidToBytes = (uuid: string) => Uint8Array.from(uuid.replaceAll('-', '').match(/../g) ?? [], (h) => parseInt(h, 16));
function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The school date (YYYY-MM-DD) of an instant in a timezone. */
export const schoolDateAt = (timezone: string, ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(ms));

export const windowAt = (ms: number) => Math.floor(ms / 1000 / TOKEN_WINDOW_SECONDS);
const windowStartMs = (window: number) => window * TOKEN_WINDOW_SECONDS * 1000;

export const schoolDayKey = (schoolSecret: Uint8Array, schoolDate: string) => hmac(schoolSecret, `absah-gate-day:${schoolDate}`);
export const deviceDayKey = (dayKey: Uint8Array, deviceId: string) => hmac(dayKey, `device:${deviceId}`);

async function mac(deviceKey: Uint8Array, cardId: string, window: number): Promise<Uint8Array> {
  return (await hmac(deviceKey, `${cardId}:${window}`)).slice(0, 16);
}

/** The QR text a card screen shows for the window containing `ms`. */
export async function makeCardToken(input: { cardId: string; deviceId: string; deviceKey: Uint8Array; ms: number }): Promise<string> {
  const window = windowAt(input.ms);
  const ids = new Uint8Array(32);
  ids.set(uuidToBytes(input.cardId), 0);
  ids.set(uuidToBytes(input.deviceId), 16);
  return [TOKEN_PREFIX, toBase64Url(ids), window.toString(36), toBase64Url(await mac(input.deviceKey, input.cardId, window))].join('.');
}

export interface ParsedCardToken {
  cardId: string;
  deviceId: string;
  window: number;
  mac: Uint8Array;
}

/** Splits a token; null when it is not an Absah card token at all. */
export function parseCardToken(token: string): ParsedCardToken | null {
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const [, idsPart = '', windowPart = '', macPart = ''] = parts;
  try {
    const ids = fromBase64Url(idsPart);
    const tag = fromBase64Url(macPart);
    const window = parseInt(windowPart, 36);
    if (ids.length !== 32 || tag.length !== 16 || !Number.isSafeInteger(window)) return null;
    return { cardId: bytesToUuid(ids.slice(0, 16)), deviceId: bytesToUuid(ids.slice(16)), window, mac: tag };
  } catch {
    return null;
  }
}

export type TokenCheck =
  | { ok: true; cardId: string; deviceId: string; schoolDate: string }
  | { ok: false; reason: 'malformed' | 'expired' | 'no_key' | 'bad_signature' };

/**
 * Verifies a token seen at `ms` (kiosk clock). `dayKeyFor` returns the school-day key for a date,
 * or null when the verifier does not hold it (kiosk without that day's key). Checks only the
 * signature and time; whether the device is the card's active device is the caller's job.
 */
export async function verifyCardToken(
  token: string,
  ms: number,
  timezone: string,
  dayKeyFor: (schoolDate: string) => Uint8Array | null | Promise<Uint8Array | null>,
): Promise<TokenCheck> {
  const parsed = parseCardToken(token);
  if (!parsed) return { ok: false, reason: 'malformed' };
  if (Math.abs(parsed.window - windowAt(ms)) > TOKEN_SKEW_WINDOWS) return { ok: false, reason: 'expired' };
  const schoolDate = schoolDateAt(timezone, windowStartMs(parsed.window));
  const dayKey = await dayKeyFor(schoolDate);
  if (!dayKey) return { ok: false, reason: 'no_key' };
  const expected = await mac(await deviceDayKey(dayKey, parsed.deviceId), parsed.cardId, parsed.window);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= (expected[i] ?? 0) ^ (parsed.mac[i] ?? 0);
  if (diff !== 0) return { ok: false, reason: 'bad_signature' };
  return { ok: true, cardId: parsed.cardId, deviceId: parsed.deviceId, schoolDate };
}
