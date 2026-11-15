import { MeContextResponse, SchoolMembersResponse } from '@absah/contracts';
import { Router } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { getMyContext } from '../application/get-my-context';
import { listSchoolMembers } from '../application/list-school-members';
import type { Auth } from '../infrastructure/auth';
import { resolveContext } from './context';

export function platformRouter(auth: Auth): Router {
  const router = Router();

  router.get('/me/context', resolveContext(auth, { school: 'optional' }), (req, res) => {
    sendContract(res, MeContextResponse, getMyContext(getCtx(req)));
  });

  router.get('/school/members', resolveContext(auth, { school: 'required' }), async (req, res) => {
    sendContract(res, SchoolMembersResponse, await listSchoolMembers(getActor(req)));
  });

  return router;
}
