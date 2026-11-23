import { AssignSubstituteRequest, CandidateList, CandidatesQuery, SubstitutionItem, SubstitutionList, SubstitutionsQuery } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { assignSubstitute, listSubstitutions, substituteCandidates } from '../application/substitutions';
import { clockOf } from './clock';

/** Guru pengganti (GRU-03), behind teacher.attendance. */
export function substitutionsRouter(auth: Auth): Router {
  const router = Router();
  const teacher = [resolveContext(auth, { school: 'required' }), requireCap('teacher.attendance')];

  router.get('/substitutions', ...teacher, async (req, res) => {
    sendContract(res, SubstitutionList, await listSubstitutions(getActor(req), clockOf(req).date, SubstitutionsQuery.parse(req.query).date));
  });
  router.get('/substitutions/candidates', ...teacher, async (req, res) => {
    sendContract(res, CandidateList, await substituteCandidates(getActor(req), CandidatesQuery.parse(req.query).sessionId));
  });
  router.post('/substitutions', ...teacher, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, SubstitutionItem, await assignSubstitute(actor, auditContext(req, actor), AssignSubstituteRequest.parse(req.body)), 201);
  });

  return router;
}
