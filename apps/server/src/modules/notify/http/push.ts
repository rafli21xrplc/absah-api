import { PushConfig, PushStatus, PushSubscribeRequest, PushUnsubscribeRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { subscribePush, unsubscribePush } from '../application/push';

/** Web Push for staff (NTF-06). `publicKey` null = VAPID is not configured: push is off. */
export function pushRouter(auth: Auth, publicKey: string | null): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });
  router.get('/push/config', resolveContext(auth, { school: 'optional' }), (_req, res) => {
    sendContract(res, PushConfig, { publicKey });
  });
  router.put('/push/subscriptions', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PushStatus, await subscribePush(actor, auditContext(req, actor), publicKey !== null, PushSubscribeRequest.parse(req.body)));
  });
  router.post('/push/subscriptions/remove', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PushStatus, await unsubscribePush(actor, auditContext(req, actor), publicKey !== null, PushUnsubscribeRequest.parse(req.body)));
  });
  return router;
}
