import { KioskCheckoutBatch, KioskCheckoutResults, CreateVisitorPhotoRequest, CreateVisitorPhotoResponse, CreateVisitorRequest, KioskDay, Visitor, VisitorHostList, KioskHeartbeatRequest, KioskHeartbeatResponse, KioskScanBatch, KioskScanResults, PairKioskRequest, PairKioskResponse } from '@absah/contracts';
import { Router, type RequestHandler } from 'express';
import { CapabilityDisabledError } from '../../../shared/errors';
import { sendContract } from '../../../shared/http';
import type { ObjectStorage } from '../../../shared/storage';
import { idempotent } from '../../../shared/idempotency';
import { heartbeat, pairingSchool, pairKiosk } from '../application/kiosks';
import { kioskDay, recordScans } from '../application/scans';
import { recordCheckouts } from '../application/checkouts';
import { createVisitorPhoto, registerVisitor, visitorHosts } from '../application/visitors';
import { getKiosk, kioskContext, kioskIdempotencyScope } from './kiosk-auth';

/** A capability of the kiosk's school on top of gate.enabled (404 CAPABILITY_DISABLED otherwise). */
function kioskCap(name: 'gate.visitors' | 'gate.pickup'): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!getKiosk(req).caps[name]) throw new CapabilityDisabledError(name);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Calls made by kiosk devices (no user session). */
export function kioskRouter(storage: ObjectStorage): Router {
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
    sendContract(res, KioskDay, await kioskDay(getKiosk(req), storage));
  });

  router.post('/kiosk/scans', kioskContext(), idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, KioskScanResults, await recordScans(getKiosk(req), KioskScanBatch.parse(req.body)));
  });

  /** Buku tamu (GRB-11): needs gate.visitors on top of gate.enabled. */
  const visitors = kioskCap('gate.visitors');
  router.get('/kiosk/visitor-hosts', kioskContext(), visitors, async (req, res) => {
    sendContract(res, VisitorHostList, await visitorHosts(getKiosk(req)));
  });
  router.post('/kiosk/visitor-photos', kioskContext(), visitors, idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, CreateVisitorPhotoResponse, await createVisitorPhoto(getKiosk(req), storage, CreateVisitorPhotoRequest.parse(req.body)));
  });
  router.post('/kiosk/visitors', kioskContext(), visitors, idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, Visitor, await registerVisitor(getKiosk(req), storage, CreateVisitorRequest.parse(req.body)));
  });

  /** Check-out with a penjemput (GRB-10): needs gate.pickup on top of gate.enabled. */
  const pickup = kioskCap('gate.pickup');
  router.post('/kiosk/checkouts', kioskContext(), pickup, idempotent(kioskIdempotencyScope), async (req, res) => {
    sendContract(res, KioskCheckoutResults, await recordCheckouts(getKiosk(req), KioskCheckoutBatch.parse(req.body)));
  });

  return router;
}
