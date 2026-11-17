import {
  AddTppkCaseEventRequest,
  CreateTppkCaseRequest,
  CreateTppkReportRequest,
  SetTppkMembersRequest,
  TppkCaseDetail,
  TppkCaseIdParam,
  TppkCaseList,
  TppkCaseNoteRequest,
  TppkCasesQuery,
  TppkChannel,
  TppkCodeParam,
  TppkMemberList,
  TppkReportDetail,
  TppkReportIdParam,
  TppkReportList,
  TppkReportReceipt,
  TppkReportsQuery,
  TppkSchoolParam,
  TppkTrackResponse,
} from '@absah/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { memoryRateLimit } from '../../../shared/rate-limit';
import { resolveContext, type Auth } from '../../platform';
import { addCaseEvent, caseForTeam, casesForTeam, closeCase, openCase, reopenCase, reportForTeam, reportsForTeam } from '../application/tppk-cases';
import { getTeam, setTeam } from '../application/tppk-members';
import { fileReport, reportChannel, trackReport } from '../application/tppk-reports';

const HOUR = 60 * 60 * 1000;

/** TPPK (KSW-06/07), behind student.tppk. */
export function tppkRouter(auth: Auth): Router {
  const router = Router();
  const staff = [resolveContext(auth, { school: 'required' }), requireCap('student.tppk')];

  // Public: no login needed (QR poster). Rate limited in memory by a keyed hash of the IP; no IP
  // reaches the database or the request log. No Idempotency-Key: a key would tie the stored
  // answer (with the tracking code) to the request.
  router.get('/tppk/channel/:schoolId', memoryRateLimit({ name: 'tppk-channel', limit: 60, windowMs: HOUR }), async (req, res) => {
    sendContract(res, TppkChannel, await reportChannel(TppkSchoolParam.parse(req.params).schoolId));
  });
  router.post('/tppk/reports', memoryRateLimit({ name: 'tppk-report', limit: 5, windowMs: HOUR }), async (req, res) => {
    const input = CreateTppkReportRequest.parse(req.body);
    // A named report from a signed-in user keeps the account; an anonymous one never looks at it.
    const session = input.anonymous ? null : await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    sendContract(res, TppkReportReceipt, await fileReport(input, session?.user.id ?? null, req.requestId), 201);
  });
  router.get('/tppk/reports/track/:code', memoryRateLimit({ name: 'tppk-track', limit: 30, windowMs: HOUR / 6 }), async (req, res) => {
    sendContract(res, TppkTrackResponse, await trackReport(TppkCodeParam.safeParse(req.params).data?.code ?? ''));
  });

  router.get('/tppk/members', ...staff, async (req, res) => {
    sendContract(res, TppkMemberList, await getTeam(getActor(req)));
  });
  router.put('/tppk/members', ...staff, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkMemberList, await setTeam(actor, auditContext(req, actor), SetTppkMembersRequest.parse(req.body)));
  });

  // Members only (KSW-07). Every call is audited inside the use case.
  router.get('/tppk/reports', ...staff, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkReportList, await reportsForTeam(actor, auditContext(req, actor), TppkReportsQuery.parse(req.query).status));
  });
  router.get('/tppk/reports/:reportId', ...staff, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkReportDetail, await reportForTeam(actor, auditContext(req, actor), TppkReportIdParam.parse(req.params).reportId));
  });
  router.get('/tppk/cases', ...staff, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkCaseList, await casesForTeam(actor, auditContext(req, actor), TppkCasesQuery.parse(req.query).status));
  });
  router.post('/tppk/cases', ...staff, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkCaseDetail, await openCase(actor, auditContext(req, actor), CreateTppkCaseRequest.parse(req.body)));
  });
  router.get('/tppk/cases/:caseId', ...staff, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkCaseDetail, await caseForTeam(actor, auditContext(req, actor), TppkCaseIdParam.parse(req.params).caseId));
  });
  router.post('/tppk/cases/:caseId/events', ...staff, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { caseId } = TppkCaseIdParam.parse(req.params);
    sendContract(res, TppkCaseDetail, await addCaseEvent(actor, auditContext(req, actor), caseId, AddTppkCaseEventRequest.parse(req.body)));
  });
  router.post('/tppk/cases/:caseId/close', ...staff, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { caseId } = TppkCaseIdParam.parse(req.params);
    sendContract(res, TppkCaseDetail, await closeCase(actor, auditContext(req, actor), caseId, TppkCaseNoteRequest.parse(req.body)));
  });
  router.post('/tppk/cases/:caseId/reopen', ...staff, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { caseId } = TppkCaseIdParam.parse(req.params);
    sendContract(res, TppkCaseDetail, await reopenCase(actor, auditContext(req, actor), caseId, TppkCaseNoteRequest.parse(req.body)));
  });

  return router;
}
