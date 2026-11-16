import { NotificationOverview } from '@absah/contracts';
import { Router } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { notificationOverview } from '../application/overview';

/** Admin dashboard of WhatsApp delivery (NTF). */
export function notificationsRouter(auth: Auth): Router {
  const router = Router();
  router.get('/notifications/overview', resolveContext(auth, { school: 'required' }), async (req, res) => {
    const ctx = getCtx(req);
    const timezone = ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
    sendContract(res, NotificationOverview, await notificationOverview(getActor(req), timezone));
  });
  return router;
}
