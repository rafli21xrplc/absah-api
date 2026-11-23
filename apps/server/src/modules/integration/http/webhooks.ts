import { CreatedWebhook, CreateWebhookRequest, UpdateWebhookRequest, Webhook, WebhookIdParam, WebhookList } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { createWebhookEndpoint, deleteWebhookEndpoint, listWebhookEndpoints, updateWebhookEndpoint } from '../application/webhooks';

/** PLT-09: the admin manages where the school's webhooks go. Behind platform.openApi. */
export function webhooksRouter(auth: Auth): Router {
  const router = Router();
  const admin = [resolveContext(auth, { school: 'required' }), requireCap('platform.openApi')];

  router.get('/integrations/webhooks', ...admin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, WebhookList, await listWebhookEndpoints(getActor(req)));
  });
  router.post('/integrations/webhooks', ...admin, idempotent(), async (req, res) => {
    const actor = getActor(req);
    res.set('Cache-Control', 'no-store');
    sendContract(res, CreatedWebhook, await createWebhookEndpoint(actor, auditContext(req, actor), CreateWebhookRequest.parse(req.body)), 201);
  });
  router.patch('/integrations/webhooks/:webhookId', ...admin, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, Webhook, await updateWebhookEndpoint(actor, auditContext(req, actor), WebhookIdParam.parse(req.params).webhookId, UpdateWebhookRequest.parse(req.body)));
  });
  router.delete('/integrations/webhooks/:webhookId', ...admin, idempotent(), async (req, res) => {
    const actor = getActor(req);
    await deleteWebhookEndpoint(actor, auditContext(req, actor), WebhookIdParam.parse(req.params).webhookId);
    res.status(204).end();
  });
  return router;
}
