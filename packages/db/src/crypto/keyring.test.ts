import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  decryptWith,
  encryptWith,
  keyedHash,
  keyedHashEquals,
  keyIdOf,
  parseKeyring,
  rotateWith,
  sensitive,
} from './keyring';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');
const ctx = 'uks_visits.note';

describe('column encryption', () => {
  const ring = parseKeyring(`k1:${k1}`, 'k1');

  it('round-trips text, including non-ASCII and empty strings', () => {
    for (const text of ['Demam 38,5°C, dipulangkan', '', 'خط عربي 🙂']) {
      expect(decryptWith(ring, encryptWith(ring, text, ctx), ctx)).toBe(text);
    }
  });

  it('never repeats a ciphertext and hides the plaintext', () => {
    const a = encryptWith(ring, 'rahasia', ctx);
    const b = encryptWith(ring, 'rahasia', ctx);
    expect(a).not.toBe(b);
    expect(a).not.toContain('rahasia');
    expect(a).toMatch(/^v1:k1:[\w-]+:[\w-]+:[\w-]*$/);
  });

  it('rejects a value moved to another column (AAD) or tampered with', () => {
    const c = encryptWith(ring, 'catatan', ctx);
    expect(() => decryptWith(ring, c, 'bk_notes.note')).toThrow(/authentication failed/);
    const parts = c.split(':');
    parts[4] = Buffer.from('xxxx').toString('base64url');
    expect(() => decryptWith(ring, parts.join(':'), ctx)).toThrow(/authentication failed/);
    expect(() => decryptWith(ring, 'plain text', ctx)).toThrow(/not an Absah ciphertext/);
  });

  it('error messages never contain the plaintext or ciphertext', () => {
    const c = encryptWith(ring, 'NIK 3201010101010001', ctx);
    try {
      decryptWith(ring, c, 'other.column');
    } catch (e) {
      expect(String(e)).not.toContain('3201010101010001');
      expect(String(e)).not.toContain(c);
    }
  });
});

describe('key rotation', () => {
  it('decrypts old values after a new key becomes active, and re-encrypts them on rotate', () => {
    const old = parseKeyring(`k1:${k1}`, 'k1');
    const legacy = encryptWith(old, 'nomor penjemput', ctx);

    const rotated = parseKeyring(`k2:${k2},k1:${k1}`, 'k2');
    expect(decryptWith(rotated, legacy, ctx)).toBe('nomor penjemput');
    expect(keyIdOf(encryptWith(rotated, 'baru', ctx))).toBe('k2');

    const migrated = rotateWith(rotated, legacy, ctx);
    expect(keyIdOf(migrated)).toBe('k2');
    expect(decryptWith(parseKeyring(`k2:${k2}`, 'k2'), migrated, ctx)).toBe('nomor penjemput');
    expect(rotateWith(rotated, migrated, ctx)).toBe(migrated); // already current: unchanged
  });

  it('fails clearly once a retired key is removed too early', () => {
    const legacy = encryptWith(parseKeyring(`k1:${k1}`, 'k1'), 'x', ctx);
    expect(() => decryptWith(parseKeyring(`k2:${k2}`, 'k2'), legacy, ctx)).toThrow(/unknown key id "k1"/);
  });

  it('validates the key configuration', () => {
    expect(() => parseKeyring(`k1:${Buffer.alloc(16).toString('base64')}`, 'k1')).toThrow(/32 bytes/);
    expect(() => parseKeyring(`k1:${k1}`, 'k9')).toThrow(/ACTIVE_KEY_ID/);
    expect(() => parseKeyring(`k1:${k1},k1:${k2}`, 'k1')).toThrow(/duplicate/);
    expect(() => parseKeyring(`no-separator`, 'k1')).toThrow(/<keyId>:<base64 key>/);
  });
});

describe('SensitiveText', () => {
  it('only reveals its value explicitly', () => {
    const s = sensitive('Ani dipulangkan karena demam');
    expect(s.reveal()).toBe('Ani dipulangkan karena demam');
    expect(JSON.stringify({ note: s })).toBe('{"note":"[redacted]"}');
    expect(String(s)).toBe('[redacted]');
    expect(inspect({ note: s })).not.toContain('Ani');
  });
});

describe('keyedHash', () => {
  it('is stable per key and comparable in constant time', () => {
    const h = keyedHash('k'.repeat(32), '203.0.113.7');
    expect(h).toBe(keyedHash('k'.repeat(32), '203.0.113.7'));
    expect(h).not.toBe(keyedHash('j'.repeat(32), '203.0.113.7'));
    expect(h).not.toContain('203.0.113.7');
    expect(keyedHashEquals('k'.repeat(32), '203.0.113.7', h)).toBe(true);
    expect(keyedHashEquals('k'.repeat(32), '203.0.113.8', h)).toBe(false);
  });
});
