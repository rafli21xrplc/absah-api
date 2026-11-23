import type { ApiKey, ApiKeyList, ApiKeyScope, CreatedApiKey, CreateApiKeyRequest } from '@absah/contracts';
import { API_KEY_MAX_ACTIVE } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { newApiKey } from '../../../shared/api-keys';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canManageIntegrations } from '../domain/policies';
import { activeKeyCount, findKey, insertKey, listKeys, revokeKeyRow, type ApiKeyRow } from '../infrastructure/api-key-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

export const viewKey = (r: ApiKeyRow): ApiKey => ({
  id: r.id,
  name: r.name,
  scopes: r.scopes as ApiKeyScope[],
  rateLimitPerMinute: r.rateLimitPerMinute,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null,
});

export function listApiKeys(actor: Actor): Promise<ApiKeyList> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => ({ items: (await listKeys(tx)).map(viewKey) }));
}

/** Creates a key and returns it once. At most API_KEY_MAX_ACTIVE active keys per school (409 too_many). */
export function createApiKey(actor: Actor, auditCtx: AuditContext, input: CreateApiKeyRequest): Promise<CreatedApiKey> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => {
    if ((await activeKeyCount(tx)) >= API_KEY_MAX_ACTIVE) throw new ConflictError('Kunci aktif sudah mencapai batas. Cabut kunci yang tidak dipakai dulu.', { reason: 'too_many' });
    const { key, hash } = newApiKey(actor.schoolId);
    const row = await insertKey(tx, { id: uuidv7(), schoolId: actor.schoolId, name: input.name, tokenHash: hash, scopes: [...new Set(input.scopes)], rateLimitPerMinute: input.rateLimitPerMinute, createdBy: actor.userId });
    // The audit log never holds the key, only what it may do.
    await audit(tx, auditCtx, 'integration.api_key_created', { type: 'api_key', id: row.id }, { after: { scopes: row.scopes, rateLimitPerMinute: row.rateLimitPerMinute } });
    return { ...viewKey(row), key };
  });
}

/** Revokes a key at once; revoking again changes nothing. */
export function revokeApiKey(actor: Actor, auditCtx: AuditContext, keyId: string): Promise<ApiKey> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => {
    if (!(await findKey(tx, keyId))) throw new NotFoundError('Kunci tidak ditemukan.');
    if (await revokeKeyRow(tx, keyId, actor.userId)) await audit(tx, auditCtx, 'integration.api_key_revoked', { type: 'api_key', id: keyId });
    const row = await findKey(tx, keyId);
    if (!row) throw new Error('api key vanished');
    return viewKey(row);
  });
}
