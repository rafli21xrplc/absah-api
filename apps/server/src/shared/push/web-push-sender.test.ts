import { describe, expect, it } from 'vitest';
import { createPushSender } from '.';
import { loadConfig } from '../config';
import { toPushError } from './web-push-sender';

describe('toPushError', () => {
  it('treats 404 and 410 as a subscription that is gone', () => {
    expect(toPushError({ statusCode: 410 }).kind).toBe('gone');
    expect(toPushError({ statusCode: 404 }).kind).toBe('gone');
  });

  it('retries network trouble, 429 and 5xx', () => {
    expect(toPushError(new Error('ECONNRESET')).kind).toBe('retryable');
    expect(toPushError({ statusCode: 429 }).kind).toBe('retryable');
    expect(toPushError({ statusCode: 503 }).kind).toBe('retryable');
  });

  it('gives up on other refusals, and never quotes the library message (it can hold the endpoint)', () => {
    const err = toPushError({ statusCode: 401, message: 'https://push.example/secret-endpoint rejected' });
    expect(err.kind).toBe('failed');
    expect(err.message).not.toContain('secret-endpoint');
  });
});

describe('push configuration', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/x',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    BETTER_AUTH_URL: 'http://localhost:4710',
    ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString('base64')}`,
    ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    HASH_KEY: 'test-hash-key-test-hash-key-test-hash-key',
  };

  it('is off without the VAPID keys', () => {
    expect(createPushSender(loadConfig({ ...base, NODE_ENV: 'test' }))).toBeNull();
  });

  it('wants all three keys or none', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', VAPID_PUBLIC_KEY: 'pub' })).toThrow(/set together or not at all/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'ops@absah.test' })).toThrow(/mailto:/);
  });
});
