import { ClassList, EnrollmentIdParam, StudentList, StudentListItem, StudentListQuery, UpdateEnrollmentRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { listClasses, listStudents, updateEnrollmentStatus } from '../application/registry';

export function registryRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/students', school, async (req, res) => {
    const query = StudentListQuery.parse(req.query);
    sendContract(res, StudentList, await listStudents(getActor(req), query));
  });

  router.get('/classes', school, async (req, res) => {
    sendContract(res, ClassList, await listClasses(getActor(req)));
  });

  router.patch('/enrollments/:enrollmentId', school, idempotent(), async (req, res) => {
    const { enrollmentId } = EnrollmentIdParam.parse(req.params);
    const input = UpdateEnrollmentRequest.parse(req.body);
    const actor = getActor(req);
    sendContract(res, StudentListItem, await updateEnrollmentStatus(actor, auditContext(req, actor), enrollmentId, input));
  });

  return router;
}
