import { ClassStudentHours, ClassStudentHoursParams, ClassStudentHoursQuery, SessionDetail, SessionIdParam, SubmitSessionRequest, TodayQuery, TodayResponse } from '@absah/contracts';
import { Router, type Request } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import { resolveContext, type Auth } from '../../platform';
import { getSession, getToday, submitSession } from '../application/sessions';
import { classStudentHours } from '../application/student-hours';

/** Today's date in the active school's timezone (CLAUDE.md rule 8). */
function schoolToday(req: Request): string {
  const ctx = getCtx(req);
  const timezone = ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
  return schoolDate(timezone);
}

export function sessionsRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/attendance/today', school, async (req, res) => {
    const { scope } = TodayQuery.parse(req.query);
    sendContract(res, TodayResponse, await getToday(getActor(req), schoolToday(req), scope === 'all'));
  });

  router.get('/sessions/:sessionId', school, async (req, res) => {
    const { sessionId } = SessionIdParam.parse(req.params);
    sendContract(res, SessionDetail, await getSession(getActor(req), sessionId));
  });

  router.post('/sessions/:sessionId/submit', school, idempotent(), async (req, res) => {
    const { sessionId } = SessionIdParam.parse(req.params);
    sendContract(res, SessionDetail, await submitSession(getActor(req), sessionId, SubmitSessionRequest.parse(req.body)));
  });

  router.get('/classes/:classId/student-hours', school, async (req, res) => {
    const { classId } = ClassStudentHoursParams.parse(req.params);
    const { date } = ClassStudentHoursQuery.parse(req.query);
    sendContract(res, ClassStudentHours, await classStudentHours(getActor(req), classId, date ?? schoolToday(req)));
  });

  return router;
}
