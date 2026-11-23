import { PklAssessmentAspectList, PklAssessmentForm, PklAssessmentList, PklAssessmentExportQuery, PklPlacementIdParam, SavePklAspectsRequest, SavePklAssessmentRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { listAspects, saveAspects } from '../application/assessment-aspects';
import { exportAssessments, getAssessment, giveAssessment, listAssessments } from '../application/assessments';
import { todayOf } from './clock';

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

  router.get('/pkl/assessments', ...pkl, async (req, res) => {
    sendContract(res, PklAssessmentList, await listAssessments(getActor(req), todayOf(req)));
  });
  router.get('/pkl/assessments/export', ...pkl, async (req, res) => {
    const { file, fileName, contentType } = await exportAssessments(getActor(req), todayOf(req), PklAssessmentExportQuery.parse(req.query));
    res.status(200).set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' }).send(file);
  });
  router.get('/pkl/placements/:placementId/assessment', ...pkl, async (req, res) => {
    const { placementId } = PklPlacementIdParam.parse(req.params);
    sendContract(res, PklAssessmentForm, await getAssessment(getActor(req), placementId, todayOf(req)));
  });
  router.put('/pkl/placements/:placementId/assessment', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { placementId } = PklPlacementIdParam.parse(req.params);
    sendContract(res, PklAssessmentForm, await giveAssessment(actor, auditContext(req, actor), placementId, todayOf(req), SavePklAssessmentRequest.parse(req.body)));
  });

  return router;
}
