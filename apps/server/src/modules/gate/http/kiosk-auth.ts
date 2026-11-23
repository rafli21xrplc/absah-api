import { KIOSK_AUTH_SCHEME } from '@absah/contracts';
import type { Request, RequestHandler } from 'express';
import { CapabilityDisabledError, UnauthenticatedError } from '../../../shared/errors';
import type { IdempotencyScopeOf } from '../../../shared/idempotency';
import { authenticateKiosk, type KioskCaller } from '../application/kiosks';

declare module 'express-serve-static-core' {
  interface Request {
    kiosk?: KioskCaller;
  }
}

/** Authenticates `Authorization: Kiosk <token>` and requires gate.enabled (404 otherwise). */
export function kioskContext(): RequestHandler {
  return async (req, _res, next) => {
    try {
      const [scheme, token] = (req.get('authorization') ?? '').split(' ');
      if (scheme !== KIOSK_AUTH_SCHEME || !token) throw new UnauthenticatedError();
      const kiosk = await authenticateKiosk(token);
      if (!kiosk.caps['gate.enabled']) throw new CapabilityDisabledError('gate.enabled');
      req.kiosk = kiosk;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function getKiosk(req: Request): KioskCaller {
  if (!req.kiosk) throw new UnauthenticatedError();
  return req.kiosk;
}

/** Idempotency-Keys of a kiosk belong to the device (it has no user). */
export const kioskIdempotencyScope: IdempotencyScopeOf = (req) => {
  const kiosk = getKiosk(req);
  return { schoolId: kiosk.schoolId, userId: kiosk.kioskId };
};
