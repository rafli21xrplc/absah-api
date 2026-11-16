import {
  ClassIdParam,
  ClassListItem,
  CreateSubjectRequest,
  PutScheduleSlotRequest,
  ReplaceSchedulePeriodsRequest,
  SchedulePeriodsResponse,
  ScheduleQuery,
  ScheduleResponse,
  ScheduleSlot,
  SlotIdParam,
  Subject,
  SubjectList,
  TeacherList,
  UpdateClassRequest,
} from '@absah/contracts';
import { Router } from 'express';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { createSubject, getPeriods, getSchedule, getSubjects, getTeachers, putSlot, removeSlot, setHomeroom, setPeriods } from '../application/schedule';

export function scheduleRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/subjects', school, async (req, res) => {
    sendContract(res, SubjectList, await getSubjects(getActor(req)));
  });
  router.post('/subjects', school, idempotent(), async (req, res) => {
    sendContract(res, Subject, await createSubject(getActor(req), CreateSubjectRequest.parse(req.body)));
  });

  router.get('/schedule/periods', school, async (req, res) => {
    sendContract(res, SchedulePeriodsResponse, await getPeriods(getActor(req)));
  });
  router.put('/schedule/periods', school, idempotent(), async (req, res) => {
    sendContract(res, SchedulePeriodsResponse, await setPeriods(getActor(req), ReplaceSchedulePeriodsRequest.parse(req.body)));
  });

  router.get('/schedule/teachers', school, async (req, res) => {
    sendContract(res, TeacherList, await getTeachers(getActor(req)));
  });

  router.get('/schedule', school, async (req, res) => {
    sendContract(res, ScheduleResponse, await getSchedule(getActor(req), ScheduleQuery.parse(req.query)));
  });
  router.put('/schedule/slots', school, idempotent(), async (req, res) => {
    sendContract(res, ScheduleSlot, await putSlot(getActor(req), PutScheduleSlotRequest.parse(req.body)));
  });
  router.delete('/schedule/slots/:slotId', school, idempotent(), async (req, res) => {
    const { slotId } = SlotIdParam.parse(req.params);
    await removeSlot(getActor(req), slotId);
    res.status(204).end();
  });

  router.patch('/classes/:classId', school, idempotent(), async (req, res) => {
    const { classId } = ClassIdParam.parse(req.params);
    const input = UpdateClassRequest.parse(req.body);
    sendContract(res, ClassListItem, await setHomeroom(getActor(req), classId, input.homeroomTeacherId));
  });

  return router;
}
