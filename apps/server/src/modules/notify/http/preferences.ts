import { NotificationPreferences, UpdateNotificationPreferencesRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { getPreferences, updatePreferences } from '../application/preferences';

/** A parent's message preferences (ORT-06). Lives under /portal: the PWA is where parents set them. */
export function preferencesRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });
  router.get('/portal/notification-preferences', school, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, NotificationPreferences, await getPreferences(getActor(req)));
  });
  router.put('/portal/notification-preferences', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, NotificationPreferences, await updatePreferences(actor, auditContext(req, actor), UpdateNotificationPreferencesRequest.parse(req.body)));
  });
  return router;
}
