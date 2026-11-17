import { CreateVisitorRequest, KioskDay, Visitor, VisitorHostList, KioskHeartbeatRequest, KioskHeartbeatResponse, KioskScanBatch, KioskScanResults, PairKioskRequest, PairKioskResponse } from '@absah/contracts';
import { Router, type RequestHandler } from 'express';
import { CapabilityDisabledError } from '../../../shared/errors';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { heartbeat, pairingSchool, pairKiosk } from '../application/kiosks';
import { kioskDay, recordScans } from '../application/scans';
import { registerVisitor, visitorHosts } from '../application/visitors';
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

  router.get('/kiosk/day', kioskContext(), async (req, res) => {
    sendContract(res, KioskDay, await kioskDay(getKiosk(req)));
  });

  router.post('/kiosk/scans', kioskContext(), idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, KioskScanResults, await recordScans(getKiosk(req), KioskScanBatch.parse(req.body)));
  });

  /** Buku tamu (GRB-11): needs gate.visitors on top of gate.enabled. */
  const visitors: RequestHandler = (req, _res, next) => {
    try {
      if (!getKiosk(req).caps['gate.visitors']) throw new CapabilityDisabledError('gate.visitors');
      next();
    } catch (err) {
      next(err);
    }
  };
  router.get('/kiosk/visitor-hosts', kioskContext(), visitors, async (req, res) => {
    sendContract(res, VisitorHostList, await visitorHosts(getKiosk(req)));
  });
  router.post('/kiosk/visitors', kioskContext(), visitors, idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, Visitor, await registerVisitor(getKiosk(req), CreateVisitorRequest.parse(req.body)));
  });

  return router;
}
