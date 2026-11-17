import { CreateUksVisitRequest, UksStudentList, UksStudentQuery, UksVisit, UksVisitList, UksVisitsQuery } from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { findStudents, listVisits, recordVisit } from '../application/uks';

const timezoneOf = (req: Request) => {
  const ctx = getCtx(req);
  return ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
};

/** UKS visits (KSW-08), behind student.uks. */
export function uksRouter(auth: Auth): Router {
  const router = Router();
  const uks = [resolveContext(auth, { school: 'required' }), requireCap('student.uks')];

  router.get('/uks/students', ...uks, async (req, res) => {
    sendContract(res, UksStudentList, await findStudents(getActor(req), UksStudentQuery.parse(req.query).q));
  });
  router.post('/uks/visits', ...uks, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, UksVisit, await recordVisit(actor, auditContext(req, actor), timezoneOf(req), CreateUksVisitRequest.parse(req.body)));
  });
  router.get('/uks/visits', ...uks, async (req, res) => {
    sendContract(res, UksVisitList, await listVisits(getActor(req), timezoneOf(req), UksVisitsQuery.parse(req.query).date));
  });

  return router;
}
