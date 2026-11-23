import { CreatePointRuleRequest, PointRule, PointRuleIdParam, PointRuleList, PointRulesQuery, UpdatePointRuleRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { createPointRule, listPointRules, updatePointRule } from '../application/point-rules';

/** Discipline points (KSW-01 now; entries, thresholds and early warnings follow), behind student.points. */
export function pointsRouter(auth: Auth): Router {
  const router = Router();
  const points = [resolveContext(auth, { school: 'required' }), requireCap('student.points')];

  router.get('/point-rules', ...points, async (req, res) => {
    sendContract(res, PointRuleList, await listPointRules(getActor(req), PointRulesQuery.parse(req.query).all ?? false));
  });
  router.post('/point-rules', ...points, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PointRule, await createPointRule(actor, auditContext(req, actor), CreatePointRuleRequest.parse(req.body)), 201);
  });
  router.put('/point-rules/:ruleId', ...points, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { ruleId } = PointRuleIdParam.parse(req.params);
    sendContract(res, PointRule, await updatePointRule(actor, auditContext(req, actor), ruleId, UpdatePointRuleRequest.parse(req.body)));
  });

  return router;
}
