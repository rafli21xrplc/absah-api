import { CreatePickupGuardianRequest, CreatePickupPhotoRequest, CreatePickupPhotoResponse, PickupGuardian, PickupGuardianActionParam, PickupGuardianIdParam, PickupGuardianList, PickupGuardiansQuery, PickupPhotoLink, StudentIdParam } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { createPickupPhoto, decidePickupGuardian, pickupGuardianQueue, pickupPhotoLink, registerPickupGuardian, studentPickupGuardians } from '../application/pickup-guardians';

/** Penjemput resmi (GRB-09), behind gate.pickup: parents register, the wali kelas or admin decides. */
export function pickupRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const pickup = [resolveContext(auth, { school: 'required' }), requireCap('gate.pickup')];

  router.post('/pickup-guardian-photos', ...pickup, idempotent(), async (req, res) => {
    sendContract(res, CreatePickupPhotoResponse, await createPickupPhoto(getActor(req), storage, CreatePickupPhotoRequest.parse(req.body)));
  });
  router.get('/students/:studentId/pickup-guardians', ...pickup, async (req, res) => {
    sendContract(res, PickupGuardianList, await studentPickupGuardians(getActor(req), StudentIdParam.parse(req.params).studentId));
  });
  router.post('/students/:studentId/pickup-guardians', ...pickup, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { studentId } = StudentIdParam.parse(req.params);
    sendContract(res, PickupGuardian, await registerPickupGuardian(actor, auditContext(req, actor), storage, studentId, CreatePickupGuardianRequest.parse(req.body)), 201);
  });
  router.get('/pickup-guardians', ...pickup, async (req, res) => {
    sendContract(res, PickupGuardianList, await pickupGuardianQueue(getActor(req), PickupGuardiansQuery.parse(req.query)));
  });
  router.get('/pickup-guardians/:pickupGuardianId/photo', ...pickup, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PickupPhotoLink, await pickupPhotoLink(actor, auditContext(req, actor), storage, PickupGuardianIdParam.parse(req.params).pickupGuardianId));
  });
  router.post('/pickup-guardians/:pickupGuardianId/:action', ...pickup, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { pickupGuardianId, action } = PickupGuardianActionParam.parse(req.params);
    sendContract(res, PickupGuardian, await decidePickupGuardian(actor, auditContext(req, actor), pickupGuardianId, action));
  });

  return router;
}
