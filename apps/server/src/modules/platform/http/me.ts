import {
  MeContextResponse,
  MembershipIdParam,
  SchoolMember,
  SchoolMembersResponse,
  UpdateMembershipStatusRequest,
} from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { getMyContext } from '../application/get-my-context';
import { listSchoolMembers } from '../application/list-school-members';
import { updateMembershipStatus } from '../application/update-membership-status';
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

  router.patch(
    '/school/members/:membershipId',
    resolveContext(auth, { school: 'required' }),
    idempotent(),
    async (req, res) => {
      const { membershipId } = MembershipIdParam.parse(req.params);
      const input = UpdateMembershipStatusRequest.parse(req.body);
      const actor = getActor(req);
      sendContract(res, SchoolMember, await updateMembershipStatus(actor, auditContext(req, actor), membershipId, input));
    },
  );

  return router;
}
