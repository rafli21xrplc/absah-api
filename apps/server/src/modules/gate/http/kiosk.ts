import { KioskHeartbeatRequest, KioskHeartbeatResponse, PairKioskRequest, PairKioskResponse } from '@absah/contracts';
import { Router, type RequestHandler } from 'express';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { heartbeat, pairingSchool, pairKiosk } from '../application/kiosks';
import { getKiosk, kioskContext, kioskIdempotencyScope } from './kiosk-auth';

/** Calls made by kiosk devices (no user session). */
export function kioskRouter(): Router {
  const router = Router();

  // The kiosk is not paired yet: Idempotency-Keys are scoped to the school named in the code.
  const pairingScope: RequestHandler = async (req, res, next) => {
    try {
      res.locals.pairingSchoolId = await pairingSchool(PairKioskRequest.parse(req.body).pairingCode);
      next();
    } catch (err) {
      next(err);
    }
  };
  const pairIdempotent = idempotent((req) => ({ schoolId: String(req.res?.locals.pairingSchoolId), userId: null }));
  router.post('/kiosk/pair', pairingScope, pairIdempotent, async (req, res) => {
    sendContract(res, PairKioskResponse, await pairKiosk(PairKioskRequest.parse(req.body)));
  });

  router.post('/kiosk/heartbeat', kioskContext(), idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, KioskHeartbeatResponse, await heartbeat(getKiosk(req), KioskHeartbeatRequest.parse(req.body)));
  });

  return router;
}
