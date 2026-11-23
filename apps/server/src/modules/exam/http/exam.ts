import { CreateExamPeriodRequest, CreateExamRoomRequest, EligibilityList, EligibilityQuery, ExamPeriod, ExamPeriodIdParam, ExamCheckIn, ExamCheckInRequest, ExamPeriodList, ExamPeriodsQuery, ExamScanRequest, RoomAttendance, ExamRoom, ExamRoomIdParam, ExamRoomList, ExamRoomSeatParam, RoomRoster, SeatStudentsRequest, SeatStudentsResult, UpdateExamRoomRequest, UpdateExamPeriodRequest } from '@absah/contracts';
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
import { checkInByCard, checkInManually, roomAttendance } from '../application/attendance';
import { createExamRoom, listExamRooms, removeExamRoom, updateExamRoom } from '../application/rooms';
import { roomRoster, seatStudents, unseatStudent } from '../application/seating';
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

  router.get('/exam/periods/:periodId/rooms', ...exam, async (req, res) => {
    sendContract(res, ExamRoomList, await listExamRooms(getActor(req), ExamPeriodIdParam.parse(req.params).periodId));
  });
  router.post('/exam/periods/:periodId/rooms', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ExamRoom, await createExamRoom(actor, auditContext(req, actor), ExamPeriodIdParam.parse(req.params).periodId, CreateExamRoomRequest.parse(req.body)), 201);
  });
  router.patch('/exam/rooms/:roomId', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ExamRoom, await updateExamRoom(actor, auditContext(req, actor), ExamRoomIdParam.parse(req.params).roomId, UpdateExamRoomRequest.parse(req.body)));
  });
  router.delete('/exam/rooms/:roomId', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    await removeExamRoom(actor, auditContext(req, actor), ExamRoomIdParam.parse(req.params).roomId);
    res.status(204).end();
  });
  router.get('/exam/rooms/:roomId/students', ...exam, async (req, res) => {
    sendContract(res, RoomRoster, await roomRoster(getActor(req), ExamRoomIdParam.parse(req.params).roomId));
  });
  router.post('/exam/rooms/:roomId/students', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, SeatStudentsResult, await seatStudents(actor, auditContext(req, actor), ExamRoomIdParam.parse(req.params).roomId, SeatStudentsRequest.parse(req.body)));
  });
  router.delete('/exam/rooms/:roomId/students/:enrollmentId', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { roomId, enrollmentId } = ExamRoomSeatParam.parse(req.params);
    await unseatStudent(actor, auditContext(req, actor), roomId, enrollmentId);
    res.status(204).end();
  });

  router.get('/exam/rooms/:roomId/attendance', ...exam, async (req, res) => {
    sendContract(res, RoomAttendance, await roomAttendance(getActor(req), ExamRoomIdParam.parse(req.params).roomId));
  });
  router.post('/exam/rooms/:roomId/attendance', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { result, created } = await checkInManually(actor, auditContext(req, actor), ExamRoomIdParam.parse(req.params).roomId, ExamCheckInRequest.parse(req.body));
    sendContract(res, ExamCheckIn, result, created ? 201 : 200);
  });
  router.post('/exam/rooms/:roomId/scan', ...exam, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { result, created } = await checkInByCard(actor, auditContext(req, actor), ExamRoomIdParam.parse(req.params).roomId, ExamScanRequest.parse(req.body));
    sendContract(res, ExamCheckIn, result, created ? 201 : 200);
  });

  return router;
}
