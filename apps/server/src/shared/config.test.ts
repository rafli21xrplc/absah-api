import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(c.PORT).toBe(4000);
    expect(c.DB_APP_ROLE).toBe('absah_app');
  });

  it('fails fast with a readable message on a bad env', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not a url', PORT: '-1' })).toThrow(/DATABASE_URL.*PORT|PORT.*DATABASE_URL/);
  });
});
