import { ClassList, EnrollmentIdParam, StudentContacts, StudentIdParam, StudentList, StudentListItem, StudentListQuery, UpdateEnrollmentRequest, UpdateStudentContactsRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { getStudentContacts, updateStudentContacts } from '../application/contacts';
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

  router.get('/students/:studentId/contacts', school, async (req, res) => {
    sendContract(res, StudentContacts, await getStudentContacts(auth, getActor(req), StudentIdParam.parse(req.params).studentId));
  });

  router.put('/students/:studentId/contacts', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const input = UpdateStudentContactsRequest.parse(req.body);
    sendContract(res, StudentContacts, await updateStudentContacts(auth, actor, auditContext(req, actor), StudentIdParam.parse(req.params).studentId, input));
  });

  return router;
}
