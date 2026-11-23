import { DecideTeacherLeaveRequest, CreateTeacherLeaveRequest, TeacherLeave, TeacherLeaveIdParam, TeacherLeaveList, TeacherLeavesQuery } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { cancelTeacherLeave, decideTeacherLeave, listTeacherLeaves, requestTeacherLeave } from '../application/leave';
import { clockOf } from './clock';

/** Izin guru (GRU-02), behind teacher.attendance. */
export function teacherLeaveRouter(auth: Auth): Router {
  const router = Router();
  const teacher = [resolveContext(auth, { school: 'required' }), requireCap('teacher.attendance')];

  router.get('/teacher-leaves', ...teacher, async (req, res) => {
    sendContract(res, TeacherLeaveList, await listTeacherLeaves(getActor(req), TeacherLeavesQuery.parse(req.query)));
  });
  router.post('/teacher-leaves', ...teacher, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TeacherLeave, await requestTeacherLeave(actor, auditContext(req, actor), clockOf(req).date, CreateTeacherLeaveRequest.parse(req.body)), 201);
  });
  router.post('/teacher-leaves/:leaveId/decide', ...teacher, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TeacherLeave, await decideTeacherLeave(actor, auditContext(req, actor), TeacherLeaveIdParam.parse(req.params).leaveId, DecideTeacherLeaveRequest.parse(req.body)));
  });
  router.post('/teacher-leaves/:leaveId/cancel', ...teacher, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TeacherLeave, await cancelTeacherLeave(actor, auditContext(req, actor), clockOf(req).date, TeacherLeaveIdParam.parse(req.params).leaveId));
  });

  return router;
}
