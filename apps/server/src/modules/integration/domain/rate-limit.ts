/**
 * Fixed-window limit per API key, kept in this process's memory (decided for PLT-09 v1: with N instances the real limit is up to
 * N times the key's, Cloudflare stays the first line). The key is the key's id, so nothing personal is held. Only keys that
 * passed authentication are tracked: unknown keys never grow the map.
 */
export interface LimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window ends. */
  resetInSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;

export class KeyRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one request against the key's own limit per minute. */
  hit(keyId: string, limitPerMinute: number): LimitResult {
    const t = this.now();
    if (this.windows.size > MAX_KEYS) {
      for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
      if (this.windows.size > MAX_KEYS) this.windows.clear();
    }
    const current = this.windows.get(keyId);
    const window = current && current.resetAt > t ? current : { count: 0, resetAt: t + WINDOW_MS };
    window.count += 1;
    this.windows.set(keyId, window);
    return {
      allowed: window.count <= limitPerMinute,
      limit: limitPerMinute,
      remaining: Math.max(0, limitPerMinute - window.count),
      resetInSeconds: Math.max(1, Math.ceil((window.resetAt - t) / 1000)),
    };
  }
}
