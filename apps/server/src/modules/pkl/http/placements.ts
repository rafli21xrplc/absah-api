import { CreatePklPlacementsRequest, PklPlacement, PklPlacementIdParam, PklPlacementList, PklPlacementQuery, UpdatePklPlacementRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { cancelPklPlacement, createPklPlacements, listPklPlacements, patchPklPlacement } from '../application/placements';
import { todayOf } from './clock';

/** PKL placements (PKL-01), behind pkl.enabled. */
export function pklPlacementsRouter(auth: Auth): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/placements', ...pkl, async (req, res) => {
    sendContract(res, PklPlacementList, await listPklPlacements(getActor(req), todayOf(req), PklPlacementQuery.parse(req.query)));
  });
  router.post('/pkl/placements', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PklPlacementList, await createPklPlacements(auth, actor, auditContext(req, actor), todayOf(req), CreatePklPlacementsRequest.parse(req.body)), 201);
  });
  router.patch('/pkl/placements/:placementId', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { placementId } = PklPlacementIdParam.parse(req.params);
    sendContract(res, PklPlacement, await patchPklPlacement(auth, actor, auditContext(req, actor), todayOf(req), placementId, UpdatePklPlacementRequest.parse(req.body)));
  });
  router.post('/pkl/placements/:placementId/cancel', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { placementId } = PklPlacementIdParam.parse(req.params);
    sendContract(res, PklPlacement, await cancelPklPlacement(actor, auditContext(req, actor), todayOf(req), placementId));
  });

  return router;
}
