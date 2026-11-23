import { CreateMemorizationLogRequest, MemorizationLog, MemorizationLogList, MemorizationLogQuery, MemorizationStudentList, MemorizationStudentQuery } from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import { resolveContext, type Auth } from '../../platform';
import { memorizationLogs, memorizationStudents, recordMemorization } from '../application/memorization';

const todayOf = (req: Request) => {
  const ctx = getCtx(req);
  return schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
};

/** Setoran hafalan (KEG-03), behind religious.memorization. */
export function memorizationRouter(auth: Auth): Router {
  const router = Router();
  const guard = [resolveContext(auth, { school: 'required' }), requireCap('religious.memorization')];

  // Before any /memorization-logs/:id route.
  router.get('/memorization-logs/students', ...guard, async (req, res) => {
    sendContract(res, MemorizationStudentList, await memorizationStudents(getActor(req), MemorizationStudentQuery.parse(req.query).q));
  });
  router.get('/memorization-logs', ...guard, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, MemorizationLogList, await memorizationLogs(getActor(req), MemorizationLogQuery.parse(req.query).studentId));
  });
  router.post('/memorization-logs', ...guard, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, MemorizationLog, await recordMemorization(actor, auditContext(req, actor), todayOf(req), CreateMemorizationLogRequest.parse(req.body)), 201);
  });
  return router;
}
