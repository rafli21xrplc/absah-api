import { PickupEvent, PickupEventActionParam, PickupEventIdParam, PickupEventList, PickupEventsQuery, CreatePickupGuardianRequest, CreatePickupPhotoRequest, CreatePickupPhotoResponse, PickupGuardian, PickupGuardianActionParam, PickupGuardianIdParam, PickupGuardianList, PickupGuardiansQuery, PickupPhotoLink, StudentIdParam } from '@absah/contracts';
import { Router, type Request } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { listPickups, staffDecidePickup, unlistedPhotoLink } from '../application/unlisted-pickups';
import { createPickupPhoto, decidePickupGuardian, pickupGuardianQueue, pickupPhotoLink, registerPickupGuardian, studentPickupGuardians } from '../application/pickup-guardians';

const timezoneOf = (req: Request) => {
  const ctx = getCtx(req);
  return ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
};

/** Penjemput resmi (GRB-09) and check-outs (GRB-10), behind gate.pickup. */
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

  // Check-outs of the day and held unlisted penjemput (GRB-10).
  router.get('/pickups', ...pickup, async (req, res) => {
    sendContract(res, PickupEventList, await listPickups(getActor(req), timezoneOf(req), PickupEventsQuery.parse(req.query)));
  });
  router.get('/pickups/:pickupEventId/photo', ...pickup, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PickupPhotoLink, await unlistedPhotoLink(actor, auditContext(req, actor), storage, PickupEventIdParam.parse(req.params).pickupEventId));
  });
  router.post('/pickups/:pickupEventId/:action', ...pickup, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { pickupEventId, action } = PickupEventActionParam.parse(req.params);
    sendContract(res, PickupEvent, await staffDecidePickup(actor, auditContext(req, actor), timezoneOf(req), pickupEventId, action));
  });

  return router;
}
