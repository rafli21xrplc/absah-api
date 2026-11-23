import {
  SchoolCapabilitiesResponse,
  SchoolSetupResponse,
  SetupStepParam,
  UpdateSetupStepRequest,
  SchoolProfileResponse,
  UpdateSchoolCapabilitiesRequest,
  UpdateSchoolProfileRequest,
} from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { getSchoolCapabilities, updateSchoolCapabilities, updateSchoolProfile } from '../application/school-settings';
import { completeSchoolSetup, getSchoolSetup, markSetupStep } from '../application/school-setup';

export function academicRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.patch('/school/profile', school, idempotent(), async (req, res) => {
    const input = UpdateSchoolProfileRequest.parse(req.body);
    const actor = getActor(req);
    sendContract(res, SchoolProfileResponse, await updateSchoolProfile(actor, auditContext(req, actor), input));
  });

  router.get('/school/capabilities', school, async (req, res) => {
    sendContract(res, SchoolCapabilitiesResponse, await getSchoolCapabilities(getActor(req)));
  });

  router.put('/school/capabilities', school, idempotent(), async (req, res) => {
    const input = UpdateSchoolCapabilitiesRequest.parse(req.body);
    const actor = getActor(req);
    sendContract(res, SchoolCapabilitiesResponse, await updateSchoolCapabilities(actor, auditContext(req, actor), input));
  });

  router.get('/school/setup', school, async (req, res) => {
    sendContract(res, SchoolSetupResponse, await getSchoolSetup(getActor(req)));
  });

  router.put('/school/setup/steps/:step', school, async (req, res) => {
    const { step } = SetupStepParam.parse(req.params);
    const input = UpdateSetupStepRequest.parse(req.body);
    sendContract(res, SchoolSetupResponse, await markSetupStep(getActor(req), step, input));
  });

  router.post('/school/setup/complete', school, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, SchoolSetupResponse, await completeSchoolSetup(actor, auditContext(req, actor)));
  });

  return router;
}
