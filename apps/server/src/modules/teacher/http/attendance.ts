import { TeacherAttendance, TeacherReport, TeacherReportQuery, TeacherToday } from '@absah/contracts';
import { Router } from 'express';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { checkIn, checkOut, teacherToday } from '../application/attendance';
import { teacherMonthlyReport } from '../application/report';
import { clockOf } from './clock';

/** Teacher attendance from the staff app (GRU-01), behind teacher.attendance. */
export function teacherAttendanceRouter(auth: Auth): Router {
  const router = Router();
  const teacher = [resolveContext(auth, { school: 'required' }), requireCap('teacher.attendance')];

  router.get('/teacher-attendance/today', ...teacher, async (req, res) => {
    sendContract(res, TeacherToday, await teacherToday(getActor(req), clockOf(req)));
  });
  router.get('/teacher-attendance/report', ...teacher, async (req, res) => {
    sendContract(res, TeacherReport, await teacherMonthlyReport(getActor(req), clockOf(req).date, TeacherReportQuery.parse(req.query)));
  });
  router.post('/teacher-attendance/check-in', ...teacher, idempotent(), async (req, res) => {
    const { attendance, created } = await checkIn(getActor(req), clockOf(req));
    sendContract(res, TeacherAttendance, attendance, created ? 201 : 200);
  });
  router.post('/teacher-attendance/check-out', ...teacher, idempotent(), async (req, res) => {
    sendContract(res, TeacherAttendance, await checkOut(getActor(req), clockOf(req)));
  });

  return router;
}
