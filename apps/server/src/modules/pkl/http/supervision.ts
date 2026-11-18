import { ConfirmPklCheckinsRequest, DisputePklCheckinRequest, PklCheckinIdParam, PklSupervisionDay, PklSupervisionQuery } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { confirmCheckins, disputeCheckin, supervisionDay } from '../application/supervision';
import { timezoneOf } from './clock';

/** The industry supervisor's portal (/dudi, PKL-02), behind pkl.enabled. */
export function pklSupervisionRouter(auth: Auth): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/supervision', ...pkl, async (req, res) => {
    sendContract(res, PklSupervisionDay, await supervisionDay(getActor(req), timezoneOf(req), PklSupervisionQuery.parse(req.query).date));
  });
  router.post('/pkl/checkins/confirm', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PklSupervisionDay, await confirmCheckins(actor, auditContext(req, actor), timezoneOf(req), ConfirmPklCheckinsRequest.parse(req.body ?? {})));
  });
  router.post('/pkl/checkins/:checkinId/dispute', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { checkinId } = PklCheckinIdParam.parse(req.params);
    sendContract(res, PklSupervisionDay, await disputeCheckin(actor, auditContext(req, actor), checkinId, DisputePklCheckinRequest.parse(req.body)));
  });

  return router;
}
