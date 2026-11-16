import {
  CreateLeaveAttachmentRequest,
  CreateLeaveAttachmentResponse,
  CreateLeaveRequest,
  DecideLeaveRequest,
  LeaveAttachmentLink,
  LeaveRequest,
  LeaveRequestIdParam,
  LeaveRequestList,
  LeaveRequestListQuery,
  LeaveStudentList,
} from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { cancelLeave, createLeave, createLeaveAttachment, decideLeave, getLeave, getLeaves, getRequestableStudents, leaveAttachmentLink } from '../application/leave-requests';

function schoolToday(req: Request): string {
  const ctx = getCtx(req);
  return schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
}

/** Izin siswa (IZN). The portal's action links (prompt 3.3) call the same use cases. */
export function leaveRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/leave-requests/students', school, async (req, res) => {
    sendContract(res, LeaveStudentList, await getRequestableStudents(getActor(req)));
  });
  router.post('/leave-requests/attachments', school, idempotent(), async (req, res) => {
    sendContract(res, CreateLeaveAttachmentResponse, await createLeaveAttachment(getActor(req), storage, CreateLeaveAttachmentRequest.parse(req.body)));
  });
  router.post('/leave-requests', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, LeaveRequest, await createLeave(actor, auditContext(req, actor), storage, schoolToday(req), CreateLeaveRequest.parse(req.body)));
  });
  router.get('/leave-requests', school, async (req, res) => {
    sendContract(res, LeaveRequestList, await getLeaves(getActor(req), LeaveRequestListQuery.parse(req.query)));
  });
  router.get('/leave-requests/:leaveRequestId', school, async (req, res) => {
    sendContract(res, LeaveRequest, await getLeave(getActor(req), LeaveRequestIdParam.parse(req.params).leaveRequestId));
  });
  router.get('/leave-requests/:leaveRequestId/attachment', school, async (req, res) => {
    sendContract(res, LeaveAttachmentLink, await leaveAttachmentLink(getActor(req), storage, LeaveRequestIdParam.parse(req.params).leaveRequestId));
  });
  router.post('/leave-requests/:leaveRequestId/decide', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { leaveRequestId } = LeaveRequestIdParam.parse(req.params);
    sendContract(res, LeaveRequest, await decideLeave(actor, auditContext(req, actor), leaveRequestId, DecideLeaveRequest.parse(req.body)));
  });
  router.post('/leave-requests/:leaveRequestId/cancel', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, LeaveRequest, await cancelLeave(actor, auditContext(req, actor), LeaveRequestIdParam.parse(req.params).leaveRequestId));
  });

  return router;
}
