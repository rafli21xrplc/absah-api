import { ClassHabitsParams, ClassHabitsQuery, ClassHabitWeek, HabitDay, HabitJournal, HabitParams, HabitRangeQuery, PutHabitsRequest, StudentIdParam } from '@absah/contracts';
import { Router, type Request, type RequestHandler } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { CapabilityDisabledError } from '../../../shared/errors';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import { resolveContext, type Auth } from '../../platform';
import { classHabitWeek, habitJournal, putHabits, type HabitMode } from '../application/habits';

const todayOf = (req: Request) => {
  const ctx = getCtx(req);
  return schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
};
const modeOf = (req: Request) => getCtx(req).caps['habits.kaih'] as HabitMode;

/** habits.kaih must be parent or student (404 CAPABILITY_DISABLED when off). */
const kaihOn: RequestHandler = (req, _res, next) => {
  const mode = getCtx(req).caps['habits.kaih'];
  next(mode === 'parent' || mode === 'student' ? undefined : new CapabilityDisabledError('habits.kaih'));
};

/** Jurnal 7 KAIH (KEG-02). */
export function habitsRouter(auth: Auth): Router {
  const router = Router();
  const guard = [resolveContext(auth, { school: 'required' }), kaihOn];

  router.get('/habits/:studentId', ...guard, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, HabitJournal, await habitJournal(getActor(req), modeOf(req), todayOf(req), StudentIdParam.parse(req.params).studentId, HabitRangeQuery.parse(req.query)));
  });
  router.put('/habits/:studentId/:date', ...guard, idempotent(), async (req, res) => {
    const { studentId, date } = HabitParams.parse(req.params);
    sendContract(res, HabitDay, await putHabits(getActor(req), modeOf(req), todayOf(req), studentId, date, PutHabitsRequest.parse(req.body)));
  });
  router.get('/classes/:classId/habits', ...guard, async (req, res) => {
    sendContract(res, ClassHabitWeek, await classHabitWeek(getActor(req), todayOf(req), ClassHabitsParams.parse(req.params).classId, ClassHabitsQuery.parse(req.query)));
  });
  return router;
}
