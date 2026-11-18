import { CreateDudiPartnerRequest, DudiPartner, DudiPartnerIdParam, DudiPartnerList, PklStaffList, PklStudentList, PklStudentQuery, UpdateDudiPartnerRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { todayOf } from './clock';
import { createDudiPartner, findPklStudents, listDudiPartners, listSchoolMentors, patchDudiPartner } from '../application/partners';

/** DUDI partners and pickers for placements (PKL-01), behind pkl.enabled. */
export function pklPartnersRouter(auth: Auth): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/partners', ...pkl, async (req, res) => {
    sendContract(res, DudiPartnerList, await listDudiPartners(getActor(req), todayOf(req)));
  });
  router.post('/pkl/partners', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, DudiPartner, await createDudiPartner(actor, auditContext(req, actor), todayOf(req), CreateDudiPartnerRequest.parse(req.body)), 201);
  });
  router.patch('/pkl/partners/:partnerId', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { partnerId } = DudiPartnerIdParam.parse(req.params);
    sendContract(res, DudiPartner, await patchDudiPartner(actor, auditContext(req, actor), todayOf(req), partnerId, UpdateDudiPartnerRequest.parse(req.body)));
  });
  router.get('/pkl/students', ...pkl, async (req, res) => {
    sendContract(res, PklStudentList, await findPklStudents(getActor(req), PklStudentQuery.parse(req.query).q));
  });
  router.get('/pkl/school-mentors', ...pkl, async (req, res) => {
    sendContract(res, PklStaffList, await listSchoolMentors(getActor(req)));
  });

  return router;
}
