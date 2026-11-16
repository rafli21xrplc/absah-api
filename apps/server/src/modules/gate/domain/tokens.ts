/**
 * Opaque credentials that carry their school so lookups run in withTenant(school) (the invitation
 * pattern, CLAUDE.md "Auth and request context"): pairing codes "<schoolId>.<secret>" and kiosk
 * device tokens "<schoolId>.<kioskId>.<secret>". Only HMACs of the secrets are stored.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{32,64}$/;

export function parsePairingCode(code: string): { schoolId: string; secret: string } | null {
  const [schoolId = '', secret = '', ...rest] = code.trim().split('.');
  return rest.length === 0 && UUID.test(schoolId) && SECRET.test(secret) ? { schoolId, secret } : null;
}

export function parseKioskToken(token: string): { schoolId: string; kioskId: string; secret: string } | null {
  const [schoolId = '', kioskId = '', secret = '', ...rest] = token.trim().split('.');
  return rest.length === 0 && UUID.test(schoolId) && UUID.test(kioskId) && SECRET.test(secret) ? { schoolId, kioskId, secret } : null;
}

/** School dates from `today`, `count` days long (the keys a bound phone keeps). */
export function nextDates(today: string, count: number): string[] {
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}
