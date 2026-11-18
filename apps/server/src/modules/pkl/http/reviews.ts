import { DecidePklDayRequest, PklDayDecision, PklReviewList, PklSessionIdParam } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { decideDay, listReviews } from '../application/reviews';
import { todayOf } from './clock';

/** The guru pembimbing's review queue and decisions (PKL-02), behind pkl.enabled. */
export function pklReviewsRouter(auth: Auth): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/reviews', ...pkl, async (req, res) => {
    sendContract(res, PklReviewList, await listReviews(getActor(req), todayOf(req)));
  });
  router.post('/pkl/days/:sessionId/decide', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { sessionId } = PklSessionIdParam.parse(req.params);
    sendContract(res, PklDayDecision, await decideDay(actor, auditContext(req, actor), todayOf(req), sessionId, DecidePklDayRequest.parse(req.body)));
  });

  return router;
}
