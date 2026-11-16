import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const KEYS = `k1:${Buffer.alloc(32, 1).toString('base64')}`;
const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEYS: KEYS,
  ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  HASH_KEY: 'h'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(BASE);
    expect(c.PORT).toBe(4000);
    expect(c.AUTH_IP_HEADERS).toEqual(['cf-connecting-ip']);
    expect(c.AUTH_RATE_LIMIT).toBe(true);
    expect(c.DB_APP_ROLE).toBe('absah_app');
  });

  it('fails fast with a readable message on a bad env', () => {
    const bad = () => loadConfig({ ...BASE, DATABASE_URL: 'not a url', PORT: '-1', BETTER_AUTH_SECRET: 'short' });
    for (const key of ['DATABASE_URL', 'PORT', 'BETTER_AUTH_SECRET']) expect(bad).toThrow(key);
  });

  it('rejects an encryption key set that does not contain the active key or has short keys', () => {
    expect(() => loadConfig({ ...BASE, ENCRYPTION_ACTIVE_KEY_ID: 'k2' })).toThrow(/ENCRYPTION_KEYS/);
    expect(() => loadConfig({ ...BASE, ENCRYPTION_KEYS: `k1:${Buffer.alloc(8).toString('base64')}` })).toThrow(/32 bytes/);
  });

  it('requires R2 storage in production, with all R2 settings', () => {
    expect(loadConfig(BASE).STORAGE_DRIVER).toBe('fs');
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(/STORAGE_DRIVER/);
    expect(() => loadConfig({ ...BASE, STORAGE_DRIVER: 'r2', R2_BUCKET: 'absah' })).toThrow(/R2_ACCOUNT_ID/);
  });
});
