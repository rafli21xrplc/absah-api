import { Activity, ActivityIdParam, ActivityList, ActivityMemberList, ActivityRecap, ActivityRecapQuery, ActivityStudentQuery, CreateActivityRequest, OpenActivitySessionRequest, SessionDetail, SetActivityMembersRequest, UpdateActivityRequest } from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { CapabilityDisabledError } from '../../../shared/errors';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { getSession } from '../../attendance';
import { resolveContext, type Auth } from '../../platform';
import { activityRecap, createActivity, findStudents, getActivity, getMembers, listForActor, patchActivity, setMembers, startSession } from '../application/activities';

const timezoneOf = (req: Request) => {
  const ctx = getCtx(req);
  return ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
};

/** KEG-03: ibadah berjamaah only for schools with religious.worship (madrasah preset); other kinds always. */
function checkKind(req: Request, kind: string | undefined) {
  if (kind === 'ibadah' && getCtx(req).caps['religious.worship'] !== true) throw new CapabilityDisabledError('religious.worship');
}

/** Kegiatan (KEG-01). */
export function activitiesRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/activities', school, async (req, res) => {
    sendContract(res, ActivityList, await listForActor(getActor(req)));
  });
  router.post('/activities', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const input = CreateActivityRequest.parse(req.body);
    checkKind(req, input.kind);
    sendContract(res, Activity, await createActivity(actor, auditContext(req, actor), input));
  });
  // Before /activities/:activityId, so "students" is not taken for an id.
  router.get('/activities/students', school, async (req, res) => {
    sendContract(res, ActivityMemberList, await findStudents(getActor(req), ActivityStudentQuery.parse(req.query).q));
  });
  router.get('/activities/:activityId', school, async (req, res) => {
    sendContract(res, Activity, await getActivity(getActor(req), ActivityIdParam.parse(req.params).activityId));
  });
  router.patch('/activities/:activityId', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const input = UpdateActivityRequest.parse(req.body);
    checkKind(req, input.kind);
    sendContract(res, Activity, await patchActivity(actor, auditContext(req, actor), ActivityIdParam.parse(req.params).activityId, input));
  });
  router.get('/activities/:activityId/members', school, async (req, res) => {
    sendContract(res, ActivityMemberList, await getMembers(getActor(req), ActivityIdParam.parse(req.params).activityId));
  });
  router.put('/activities/:activityId/members', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ActivityMemberList, await setMembers(actor, auditContext(req, actor), ActivityIdParam.parse(req.params).activityId, SetActivityMembersRequest.parse(req.body)));
  });
  // Opening twice gives the same session (one per activity per day), so no Idempotency-Key.
  router.post('/activities/:activityId/sessions', school, async (req, res) => {
    const actor = getActor(req);
    const { activityId } = ActivityIdParam.parse(req.params);
    const sessionId = await startSession(actor, timezoneOf(req), activityId, OpenActivitySessionRequest.parse(req.body ?? {}).date);
    sendContract(res, SessionDetail, await getSession(actor, sessionId));
  });
  router.get('/activities/:activityId/recap', school, async (req, res) => {
    const { from, to } = ActivityRecapQuery.parse(req.query);
    sendContract(res, ActivityRecap, await activityRecap(getActor(req), ActivityIdParam.parse(req.params).activityId, from, to));
  });

  return router;
}
