import { z } from 'zod';

/**
 * Open API for third parties (PLT-09), behind the capability platform.openApi. The admin creates keys per school; a key
 * carries scopes and a rate limit. The key is shown ONCE, at creation: only its HMAC is stored.
 */

/** What a key may do. v1: read the daily attendance, nothing else (no names, no writes). */
export const API_KEY_SCOPES = ['attendance:read'] as const;
export const ApiKeyScope = z.enum(API_KEY_SCOPES).meta({ id: 'ApiKeyScope' });
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

export const API_KEY_PREFIX = 'abk_';
export const API_KEY_DEFAULT_RATE = 60;
export const API_KEY_MIN_RATE = 10;
export const API_KEY_MAX_RATE = 600;
/** Active keys per school: a leaked key is revoked, not stacked up. */
export const API_KEY_MAX_ACTIVE = 10;

export const ApiKey = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scopes: z.array(ApiKeyScope),
    /** Requests per minute. */
    rateLimitPerMinute: z.int(),
    createdAt: z.iso.datetime({ offset: true }),
    lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
    /** Set once revoked; a revoked key is refused at once. */
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'ApiKey' });
export type ApiKey = z.infer<typeof ApiKey>;

export const ApiKeyList = z.object({ items: z.array(ApiKey) }).meta({ id: 'ApiKeyList' });
export type ApiKeyList = z.infer<typeof ApiKeyList>;

export const CreateApiKeyRequest = z
  .object({
    name: z.string().trim().min(2, 'Beri nama kunci, misalnya nama aplikasinya.').max(60),
    scopes: z.array(ApiKeyScope).min(1, 'Pilih minimal satu izin.').max(API_KEY_SCOPES.length),
    rateLimitPerMinute: z.int().min(API_KEY_MIN_RATE).max(API_KEY_MAX_RATE).default(API_KEY_DEFAULT_RATE),
  })
  .strict()
  .meta({ id: 'CreateApiKeyRequest' });
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

/** POST /api/v1/integrations/api-keys: the key itself, shown only here. Send it as `Authorization: Bearer <key>`. */
export const CreatedApiKey = ApiKey.extend({ key: z.string() }).meta({ id: 'CreatedApiKey' });
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

export const ApiKeyIdParam = z.object({ keyId: z.uuid() });
