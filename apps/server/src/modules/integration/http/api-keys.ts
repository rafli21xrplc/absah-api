import { ApiKey, ApiKeyIdParam, ApiKeyList, CreateApiKeyRequest, CreatedApiKey } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { createApiKey, listApiKeys, revokeApiKey } from '../application/api-keys';

/** PLT-09: the admin manages the school's open API keys. Behind platform.openApi. */
export function apiKeysRouter(auth: Auth): Router {
  const router = Router();
  const admin = [resolveContext(auth, { school: 'required' }), requireCap('platform.openApi')];

  router.get('/integrations/api-keys', ...admin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, ApiKeyList, await listApiKeys(getActor(req)));
  });
  router.post('/integrations/api-keys', ...admin, idempotent(), async (req, res) => {
    const actor = getActor(req);
    res.set('Cache-Control', 'no-store');
    sendContract(res, CreatedApiKey, await createApiKey(actor, auditContext(req, actor), CreateApiKeyRequest.parse(req.body)), 201);
  });
  router.post('/integrations/api-keys/:keyId/revoke', ...admin, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ApiKey, await revokeApiKey(actor, auditContext(req, actor), ApiKeyIdParam.parse(req.params).keyId));
  });
  return router;
}
