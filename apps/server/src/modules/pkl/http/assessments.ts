import { PklAssessmentAspectList, SavePklAspectsRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { listAspects, saveAspects } from '../application/assessment-aspects';

/** DUDI assessment (PKL-04), behind pkl.enabled. */
export function pklAssessmentsRouter(auth: Auth): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/assessment-aspects', ...pkl, async (req, res) => {
    sendContract(res, PklAssessmentAspectList, await listAspects(getActor(req)));
  });
  router.put('/pkl/assessment-aspects', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PklAssessmentAspectList, await saveAspects(actor, auditContext(req, actor), SavePklAspectsRequest.parse(req.body)));
  });

  return router;
}
