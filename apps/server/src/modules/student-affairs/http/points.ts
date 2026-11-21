import {
  CreatePointEntryRequest,
  CreatePointEvidenceRequest,
  CreatePointEvidenceResponse,
  CreatePointRuleRequest,
  PointEntry,
  PointEntryIdParam,
  PointEvidenceLink,
  PointRule,
  PointRuleIdParam,
  PointRuleList,
  PointRulesQuery,
  PointStudentParam,
  ReversePointEntryRequest,
  StudentPoints,
  UpdatePointRuleRequest,
} from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { createPointEvidence, pointEvidenceLink, recordPointEntry, reversePointEntry, studentPoints } from '../application/point-entries';
import { createPointRule, listPointRules, updatePointRule } from '../application/point-rules';

const todayOf = (req: Request) => {
  const ctx = getCtx(req);
  return schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
};

/** Discipline points (KSW-01, KSW-02; thresholds and early warnings follow), behind student.points. */
export function pointsRouter(auth: Auth, storage: ObjectStorage): Router {
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

  router.post('/point-entries/evidence', ...points, idempotent(), async (req, res) => {
    sendContract(res, CreatePointEvidenceResponse, await createPointEvidence(getActor(req), storage, CreatePointEvidenceRequest.parse(req.body)), 201);
  });
  router.post('/point-entries', ...points, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PointEntry, await recordPointEntry(actor, auditContext(req, actor), storage, todayOf(req), CreatePointEntryRequest.parse(req.body)), 201);
  });
  router.post('/point-entries/:entryId/reverse', ...points, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { entryId } = PointEntryIdParam.parse(req.params);
    sendContract(res, PointEntry, await reversePointEntry(actor, auditContext(req, actor), todayOf(req), entryId, ReversePointEntryRequest.parse(req.body)), 201);
  });
  router.get('/point-entries/:entryId/evidence', ...points, async (req, res) => {
    sendContract(res, PointEvidenceLink, await pointEvidenceLink(getActor(req), storage, PointEntryIdParam.parse(req.params).entryId));
  });
  router.get('/students/:enrollmentId/points', ...points, async (req, res) => {
    sendContract(res, StudentPoints, await studentPoints(getActor(req), PointStudentParam.parse(req.params).enrollmentId));
  });

  return router;
}
