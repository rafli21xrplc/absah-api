import { Correction, CorrectionIdParam, CorrectionList, CorrectionListQuery, CreateCorrectionsRequest, DecideCorrectionRequest, SessionIdParam } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { decide, getCorrections, requestCorrections } from '../application/corrections';

export function correctionsRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.post('/sessions/:sessionId/corrections', school, idempotent(), async (req, res) => {
    const { sessionId } = SessionIdParam.parse(req.params);
    sendContract(res, CorrectionList, await requestCorrections(getActor(req), sessionId, CreateCorrectionsRequest.parse(req.body)));
  });

  router.get('/corrections', school, async (req, res) => {
    sendContract(res, CorrectionList, await getCorrections(getActor(req), CorrectionListQuery.parse(req.query)));
  });

  router.post('/corrections/:correctionId/decide', school, idempotent(), async (req, res) => {
    const { correctionId } = CorrectionIdParam.parse(req.params);
    const actor = getActor(req);
    sendContract(res, Correction, await decide(actor, auditContext(req, actor), correctionId, DecideCorrectionRequest.parse(req.body)));
  });

  return router;
}
