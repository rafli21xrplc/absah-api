import { type ApiKeyScope } from '@absah/contracts';
import type { Request, RequestHandler } from 'express';
import { apiKeyHash, parseApiKey } from '../../../shared/api-keys';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withTenant } from '../../../shared/db';
import { CapabilityDisabledError, ForbiddenError, RateLimitedError, UnauthenticatedError } from '../../../shared/errors';
import { memoryRateLimit } from '../../../shared/rate-limit';
import { schoolDate } from '../../../shared/school-date';
import { KeyRateLimiter } from '../domain/rate-limit';
import { findKeyByHash, schoolOfKey, touchKey } from '../infrastructure/api-key-repo';

/** Who is calling the open API: filled by requireApiKey. */
export interface ApiKeyCaller {
  schoolId: string;
  keyId: string;
  scopes: readonly string[];
  /** Today's date in the school's timezone. */
  today: string;
  timezone: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: ApiKeyCaller;
  }
}

export function getApiKeyCaller(req: Request): ApiKeyCaller {
  if (!req.apiKey) throw new UnauthenticatedError('Kunci API tidak dikenal.');
  return req.apiKey;
}

const unknownKey = () => new UnauthenticatedError('Kunci API tidak dikenal atau sudah dicabut.');

/** Anyone may try keys, so lookups are limited per client first (the key itself has no say yet). */
const perClient = memoryRateLimit({ name: 'open-api-client', limit: 600, windowMs: 60_000 });

/**
 * Authenticates `Authorization: Bearer abk_...` (PLT-09): unknown, malformed and revoked keys all answer the same 401; a school
 * without platform.openApi answers 404 CAPABILITY_DISABLED; a key without the scope 403 INSUFFICIENT_SCOPE; past the key's own
 * rate 429 with Retry-After. Every answer carries X-RateLimit-* headers once the key is known. No cookies and no session.
 */
export function requireApiKey(scope: ApiKeyScope, limiter: KeyRateLimiter = new KeyRateLimiter()): RequestHandler {
  return (req, res, next) => {
    perClient(req, res, (clientErr?: unknown) => {
      if (clientErr) return next(clientErr);
      void authenticate(req, res, scope, limiter).then(() => next(), next);
    });
  };
}

async function authenticate(req: Request, res: Parameters<RequestHandler>[1], scope: ApiKeyScope, limiter: KeyRateLimiter): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const [kind, token] = (req.get('authorization') ?? '').split(' ');
  const parsed = kind === 'Bearer' && token ? parseApiKey(token) : null;
  if (!parsed) throw unknownKey();

  const found = await withTenant({ schoolId: parsed.schoolId, userId: null }, async (tx) => {
    const key = await findKeyByHash(tx, apiKeyHash(parsed.secret));
    if (!key || key.revokedAt) return null;
    const school = await schoolOfKey(tx, parsed.schoolId);
    if (!school) return null;
    const today = schoolDate(school.timezone);
    const on = resolveFromRows(school, await readCapabilityRows(tx), today)['platform.openApi'] === true;
    if (on) await touchKey(tx, key.id);
    return { key, on, today, timezone: school.timezone };
  });
  if (!found) throw unknownKey();
  if (!found.on) throw new CapabilityDisabledError('platform.openApi');

  const limit = limiter.hit(found.key.id, found.key.rateLimitPerMinute);
  res.set({ 'X-RateLimit-Limit': String(limit.limit), 'X-RateLimit-Remaining': String(limit.remaining), 'X-RateLimit-Reset': String(limit.resetInSeconds) });
  if (!limit.allowed) {
    res.set('Retry-After', String(limit.resetInSeconds));
    throw new RateLimitedError();
  }
  if (!found.key.scopes.includes(scope)) throw new ForbiddenError('Kunci ini tidak punya izin untuk data ini.');
  req.apiKey = { schoolId: parsed.schoolId, keyId: found.key.id, scopes: found.key.scopes, today: found.today, timezone: found.timezone };
}
