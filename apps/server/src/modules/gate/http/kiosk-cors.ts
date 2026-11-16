import type { RequestHandler } from 'express';

/**
 * CORS for the kiosk app only. The kiosk is a static export on its own origin (no proxy), so its
 * calls to /api/v1/kiosk/* are cross-origin. Only listed origins, no cookies: kiosks authenticate
 * with `Authorization: Kiosk <token>`. Everything else stays same-origin (the web proxies /api).
 */
export function kioskCors(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || !allowed.has(origin)) {
      next();
      return;
    }
    res.vary('Origin');
    res.set('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      res.set('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}
