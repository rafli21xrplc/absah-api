import { SetTppkMembersRequest, TppkMemberList } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { getTeam, setTeam } from '../application/tppk-members';

/** TPPK (KSW-06/07), behind student.tppk. */
export function tppkRouter(auth: Auth): Router {
  const router = Router();
  const staff = [resolveContext(auth, { school: 'required' }), requireCap('student.tppk')];

  router.get('/tppk/members', ...staff, async (req, res) => {
    sendContract(res, TppkMemberList, await getTeam(getActor(req)));
  });
  router.put('/tppk/members', ...staff, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TppkMemberList, await setTeam(actor, auditContext(req, actor), SetTppkMembersRequest.parse(req.body)));
  });

  return router;
}
