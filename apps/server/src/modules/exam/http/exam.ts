import { CreateExamPeriodRequest, ExamPeriod, ExamPeriodIdParam, ExamPeriodList, ExamPeriodsQuery, UpdateExamPeriodRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { createExamPeriod, listExamPeriods, updateExamPeriod } from '../application/periods';

/** Ujian (UJN), behind exam.enabled. */
export function examRouter(auth: Auth): Router {
  const router = Router();
  const exam = [resolveContext(auth, { school: 'required' }), requireCap('exam.enabled')];

  router.get('/exam/periods', ...exam, async (req, res) => {
    sendContract(res, ExamPeriodList, await listExamPeriods(getActor(req), ExamPeriodsQuery.parse(req.query).includeClosed));
  });
  router.post('/exam/periods', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ExamPeriod, await createExamPeriod(actor, auditContext(req, actor), CreateExamPeriodRequest.parse(req.body)), 201);
  });
  router.patch('/exam/periods/:periodId', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ExamPeriod, await updateExamPeriod(actor, auditContext(req, actor), ExamPeriodIdParam.parse(req.params).periodId, UpdateExamPeriodRequest.parse(req.body)));
  });

  return router;
}
