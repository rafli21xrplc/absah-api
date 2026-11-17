import type { RequestHandler } from 'express';
import { hashValue } from './crypto';
import { RateLimitedError } from './errors';

interface Window {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 50_000;

/**
 * Fixed-window limit per client, kept in this process's memory only: the key is a keyed hash of
 * the IP and is never written to the database or a log (TPPK: no trace of an anonymous reporter).
 * Per instance, so with N instances the real limit is up to N times higher; Cloudflare's rule for
 * the same paths is the first line (docs/architecture.md, Edge).
 */
export function memoryRateLimit(options: { name: string; limit: number; windowMs: number; now?: () => number }): RequestHandler {
  const windows = new Map<string, Window>();
  const now = options.now ?? Date.now;
  return (req, _res, next) => {
    const t = now();
    if (windows.size > MAX_KEYS) {
      for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      if (windows.size > MAX_KEYS) windows.clear();
    }
    const key = hashValue(`${options.name}:${req.clientIp ?? 'unknown'}`);
    const current = windows.get(key);
    const window = current && current.resetAt > t ? current : { count: 0, resetAt: t + options.windowMs };
    window.count += 1;
    windows.set(key, window);
    next(window.count > options.limit ? new RateLimitedError() : undefined);
  };
}
