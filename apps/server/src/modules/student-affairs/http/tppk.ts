import { CreateTppkReportRequest, SetTppkMembersRequest, TppkChannel, TppkCodeParam, TppkMemberList, TppkReportReceipt, TppkSchoolParam, TppkTrackResponse } from '@absah/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { memoryRateLimit } from '../../../shared/rate-limit';
import { resolveContext, type Auth } from '../../platform';
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

  return router;
}
