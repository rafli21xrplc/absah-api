import { randomBytes } from 'node:crypto';
import { API_KEY_PREFIX } from '@absah/contracts';
import { hashValue } from './crypto';

/**
 * Open API keys (PLT-09): "abk_<schoolId>.<secret>". The school id in front picks the tenant, so the lookup runs in
 * withTenant(school) under RLS; only the HMAC of the secret is stored. The secret is 256 bits of randomness.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export const apiKeyHash = (secret: string) => hashValue(`api-key:${secret}`);

export function newApiKey(schoolId: string): { key: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { key: `${API_KEY_PREFIX}${schoolId}.${secret}`, hash: apiKeyHash(secret) };
}

export function parseApiKey(key: string): { schoolId: string; secret: string } | null {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const [schoolId = '', secret = '', ...rest] = key.slice(API_KEY_PREFIX.length).split('.');
  return rest.length === 0 && UUID.test(schoolId) && SECRET.test(secret) ? { schoolId, secret } : null;
}
