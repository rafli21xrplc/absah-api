import { Arrival, BindCardDeviceRequest, CardDeviceKeys, GateToday, ManualArrivalRequest, DeviceIdParam, KioskDevice, KioskDeviceList, KioskIdParam, KioskPairing, MyCards } from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import { resolveContext, type Auth } from '../../platform';
import { gateToday, recordManualArrival } from '../application/arrivals';
import { bindCardDevice, getDeviceKeys, getMyCards } from '../application/cards';
import { createPairing, getKiosks, revoke } from '../application/kiosks';

function schoolClock(req: Request) {
  const ctx = getCtx(req);
  const timezone = ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
  return { timezone, today: schoolDate(timezone), holder: ctx.caps['card.holder'] ?? 'student' };
}

/** Kiosk management (admin), card binding (holders) and piket (GRB-05/06); all behind gate.enabled. */
export function gateRouter(auth: Auth): Router {
  const router = Router();
  const gate = [resolveContext(auth, { school: 'required' }), requireCap('gate.enabled')];

  router.post('/gate/kiosks/pairings', ...gate, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, KioskPairing, await createPairing(actor, auditContext(req, actor)));
  });
  router.get('/gate/kiosks', ...gate, async (req, res) => {
    sendContract(res, KioskDeviceList, await getKiosks(getActor(req)));
  });
  router.post('/gate/kiosks/:kioskId/revoke', ...gate, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, KioskDevice, await revoke(actor, auditContext(req, actor), KioskIdParam.parse(req.params).kioskId));
  });

  router.get('/cards/mine', ...gate, async (req, res) => {
    sendContract(res, MyCards, await getMyCards(getActor(req), schoolClock(req).holder));
  });
  router.post('/cards/devices', ...gate, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { timezone, today, holder } = schoolClock(req);
    sendContract(res, CardDeviceKeys, await bindCardDevice(actor, auditContext(req, actor), holder, timezone, today, BindCardDeviceRequest.parse(req.body)));
  });
  router.get('/cards/devices/:deviceId/keys', ...gate, async (req, res) => {
    const { timezone, today } = schoolClock(req);
    sendContract(res, CardDeviceKeys, await getDeviceKeys(getActor(req), timezone, today, DeviceIdParam.parse(req.params).deviceId));
  });

  router.post('/gate/arrivals', ...gate, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, Arrival, await recordManualArrival(actor, auditContext(req, actor), schoolClock(req).timezone, ManualArrivalRequest.parse(req.body)));
  });
  router.get('/gate/today', ...gate, async (req, res) => {
    sendContract(res, GateToday, await gateToday(getActor(req), schoolClock(req).timezone));
  });

  return router;
}
