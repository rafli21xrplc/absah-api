import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', BETTER_AUTH_SECRET: 'x'.repeat(32) });
    expect(c.PORT).toBe(4000);
    expect(c.AUTH_IP_HEADERS).toEqual(['cf-connecting-ip']);
    expect(c.AUTH_RATE_LIMIT).toBe(true);
    expect(c.DB_APP_ROLE).toBe('absah_app');
  });

  it('fails fast with a readable message on a bad env', () => {
    const bad = () => loadConfig({ DATABASE_URL: 'not a url', PORT: '-1', BETTER_AUTH_SECRET: 'short' });
    for (const key of ['DATABASE_URL', 'PORT', 'BETTER_AUTH_SECRET']) expect(bad).toThrow(key);
  });
});
