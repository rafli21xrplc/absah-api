import { createOTP } from '@better-auth/utils/otp';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config';
import { totpNow } from './dev-totp';

const base = {
  DATABASE_URL: 'postgres://localhost/x',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')}`,
  ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  HASH_KEY: 'h'.repeat(32),
};

describe('dev TOTP code', () => {
  it('computes the same code as Better Auth for the same secret and moment', async () => {
    const secret = 'Zz9-secret-string-made-by-better-auth';
    // Same clock tick on both sides (a tick lasts 30 s; the two calls are microseconds apart).
    const expected = await createOTP(secret, { digits: 6, period: 30 }).totp();
    expect(totpNow(secret)).toBe(expected);
  });

  it('is refused outside development', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEV_TOTP_CODE: '123456' })).toThrow(/DEV_TOTP_CODE/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', DEV_TOTP_CODE: '123456' })).toThrow(/DEV_TOTP_CODE/);
    expect(loadConfig({ ...base, NODE_ENV: 'development', DEV_TOTP_CODE: '123456' }).DEV_TOTP_CODE).toBe('123456');
    expect(() => loadConfig({ ...base, NODE_ENV: 'development', DEV_TOTP_CODE: '12345' })).toThrow(/DEV_TOTP_CODE/);
  });
});
