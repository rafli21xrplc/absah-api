import { describe, expect, it } from 'vitest';
import { KeyRateLimiter } from './rate-limit';

describe('KeyRateLimiter (PLT-09)', () => {
  it('allows the key\'s own number of requests per minute, then refuses until the window ends', () => {
    let now = 1_000_000;
    const limiter = new KeyRateLimiter(() => now);
    const results = Array.from({ length: 12 }, () => limiter.hit('k1', 10));
    expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true);
    expect(results[9]?.remaining).toBe(0);
    expect(results[10]).toMatchObject({ allowed: false, remaining: 0, limit: 10 });
    expect(results[10]?.resetInSeconds).toBe(60);
    now += 30_000;
    expect(limiter.hit('k1', 10)).toMatchObject({ allowed: false, resetInSeconds: 30 });
    now += 30_000;
    expect(limiter.hit('k1', 10)).toMatchObject({ allowed: true, remaining: 9 });
  });

  it('counts every key on its own', () => {
    const limiter = new KeyRateLimiter(() => 5);
    for (let i = 0; i < 11; i++) limiter.hit('a', 10);
    expect(limiter.hit('a', 10).allowed).toBe(false);
    expect(limiter.hit('b', 10)).toMatchObject({ allowed: true, remaining: 9 });
  });

  it('follows a limit that changes (the key was edited): the new number applies to the running window', () => {
    const limiter = new KeyRateLimiter(() => 5);
    for (let i = 0; i < 5; i++) limiter.hit('a', 100);
    expect(limiter.hit('a', 5).allowed).toBe(false);
  });
});
