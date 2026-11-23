import { PklCheckin, PklCheckinBody, PklToday } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { myPklToday, recordCheckin } from '../application/checkins';
import { timezoneOf } from './clock';

/** The student's side of PKL presence (PKL-02), behind pkl.enabled. */
export function pklCheckinsRouter(auth: Auth): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/me', ...pkl, async (req, res) => {
    sendContract(res, PklToday, await myPklToday(getActor(req), timezoneOf(req)));
  });
  // idempotent() requires the Idempotency-Key header (CLAUDE.md rule 2: PKL check-in).
  router.post('/pkl/checkins', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PklCheckin, await recordCheckin(actor, auditContext(req, actor), timezoneOf(req), PklCheckinBody.parse(req.body)), 201);
  });

  return router;
}
