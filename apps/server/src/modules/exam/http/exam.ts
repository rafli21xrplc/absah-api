import { CreateExamPeriodRequest, EligibilityList, EligibilityQuery, ExamPeriod, ExamPeriodIdParam, ExamPeriodList, ExamPeriodsQuery, UpdateExamPeriodRequest } from '@absah/contracts';
import { Router } from 'express';
import { getCtx } from '../../../shared/context';
import { schoolDate } from '../../../shared/school-date';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { examEligibility } from '../application/eligibility';
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

  router.get('/exam/periods/:periodId/eligibility', ...exam, async (req, res) => {
    const ctx = getCtx(req);
    const today = schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
    sendContract(res, EligibilityList, await examEligibility(getActor(req), ExamPeriodIdParam.parse(req.params).periodId, EligibilityQuery.parse(req.query), today));
  });

  return router;
}
