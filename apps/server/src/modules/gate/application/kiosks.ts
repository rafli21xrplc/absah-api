import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CapabilityValues } from '@absah/capabilities';
import { KIOSK_ONLINE_SECONDS, KIOSK_PAIRING_TTL_MINUTES, type KioskDevice, type KioskDeviceList, type KioskHeartbeatRequest, type KioskPairing, type PairKioskRequest, type PairKioskResponse } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { hashValue } from '../../../shared/crypto';
import { withTenant } from '../../../shared/db';
import { CapabilityDisabledError, ForbiddenError, NotFoundError, UnauthenticatedError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { canManageKiosks } from '../domain/policies';
import { parseKioskToken, parsePairingCode } from '../domain/tokens';
import { findKiosk, insertKiosk, insertPairing, listKiosks, lockOpenPairing, recordHeartbeat, revokeKiosk, schoolOf, usePairing } from '../infrastructure/kiosk-repo';

const newSecret = () => randomBytes(32).toString('base64url');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const BAD_CODE = 'Kode pairing tidak berlaku. Minta kode baru ke admin.';

/** The authenticated kiosk of a request. */
export interface KioskCaller {
  schoolId: string;
  kioskId: string;
  timezone: string;
  caps: CapabilityValues;
}

function toKioskDevice(row: Awaited<ReturnType<typeof listKiosks>>[number], now: number): KioskDevice {
  return {
    id: row.id,
    name: row.name,
    online: row.revokedAt === null && row.lastSeenAt !== null && now - row.lastSeenAt.getTime() < KIOSK_ONLINE_SECONDS * 1000,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastQueueSize: row.lastQueueSize,
    appVersion: row.appVersion,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function createPairing(actor: Actor, auditCtx: AuditContext): Promise<KioskPairing> {
  if (!canManageKiosks.allows(actor)) throw new ForbiddenError('Kios diatur oleh admin atau operator.');
  const secret = newSecret();
  const expiresAt = new Date(Date.now() + KIOSK_PAIRING_TTL_MINUTES * 60_000);
  await withTenant(scope(actor), async (tx) => {
    await insertPairing(tx, { schoolId: actor.schoolId, secretHash: hashValue(secret), expiresAt, createdBy: actor.userId });
    await audit(tx, auditCtx, 'kiosk.pairing_created', { type: 'school', id: actor.schoolId }, { after: { expiresAt: expiresAt.toISOString() } });
  });
  return { pairingCode: `${actor.schoolId}.${secret}`, expiresAt: expiresAt.toISOString() };
}

export function getKiosks(actor: Actor): Promise<KioskDeviceList> {
  if (!canManageKiosks.allows(actor)) throw new ForbiddenError('Kios diatur oleh admin atau operator.');
  return withTenant(scope(actor), async (tx) => ({ items: (await listKiosks(tx)).map((r) => toKioskDevice(r, Date.now())) }));
}

export function revoke(actor: Actor, auditCtx: AuditContext, kioskId: string): Promise<KioskDevice> {
  if (!canManageKiosks.allows(actor)) throw new ForbiddenError('Kios diatur oleh admin atau operator.');
  return withTenant(scope(actor), async (tx) => {
    if (!(await findKiosk(tx, kioskId))) throw new NotFoundError('Kios tidak ditemukan.');
    if (await revokeKiosk(tx, kioskId, new Date())) {
      await audit(tx, auditCtx, 'kiosk.revoked', { type: 'kiosk_device', id: kioskId }, { after: { revoked: true } });
    }
    const row = await findKiosk(tx, kioskId);
    if (!row) throw new NotFoundError('Kios tidak ditemukan.');
    return toKioskDevice(row, Date.now());
  });
}

/**
 * The school a pairing code names, when it exists (404 otherwise). It scopes the call's
 * Idempotency-Key before the kiosk has a token.
 */
export async function pairingSchool(code: string): Promise<string> {
  const parsed = parsePairingCode(code);
  const school = parsed ? await withTenant({ schoolId: parsed.schoolId, userId: null }, (tx) => schoolOf(tx, parsed.schoolId)) : undefined;
  if (!school) throw new NotFoundError(BAD_CODE);
  return school.id;
}

/** A kiosk claims a one-time code and receives its device token (shown once). */
export async function pairKiosk(input: PairKioskRequest): Promise<PairKioskResponse> {
  const code = parsePairingCode(input.pairingCode);
  if (!code) throw new NotFoundError(BAD_CODE);
  return withTenant({ schoolId: code.schoolId, userId: null }, async (tx) => {
    const school = await schoolOf(tx, code.schoolId);
    const pairing = school ? await lockOpenPairing(tx, hashValue(code.secret), new Date()) : undefined;
    if (!school || !pairing) throw new NotFoundError(BAD_CODE);
    const caps = resolveFromRows(school, await readCapabilityRows(tx), schoolDate(school.timezone));
    if (!caps['gate.enabled']) throw new CapabilityDisabledError('gate.enabled');

    const kioskId = uuidv7();
    const secret = newSecret();
    await insertKiosk(tx, { id: kioskId, schoolId: school.id, name: input.name, tokenHash: hashValue(secret), appVersion: input.appVersion ?? null, createdBy: null });
    await usePairing(tx, pairing.id, kioskId, new Date());
    return { deviceToken: `${school.id}.${kioskId}.${secret}`, kiosk: { id: kioskId, name: input.name }, school: { id: school.id, name: school.name, timezone: school.timezone } };
  });
}

/** Resolves `Authorization: Kiosk <token>`; 401 for unknown or revoked kiosks. */
export async function authenticateKiosk(token: string): Promise<KioskCaller> {
  const parsed = parseKioskToken(token);
  if (!parsed) throw new UnauthenticatedError();
  return withTenant({ schoolId: parsed.schoolId, userId: null }, async (tx) => {
    const kiosk = await findKiosk(tx, parsed.kioskId);
    const school = await schoolOf(tx, parsed.schoolId);
    if (!kiosk || !school || kiosk.revokedAt || !sameHash(kiosk.tokenHash, hashValue(parsed.secret))) throw new UnauthenticatedError();
    return { schoolId: school.id, kioskId: kiosk.id, timezone: school.timezone, caps: resolveFromRows(school, await readCapabilityRows(tx), schoolDate(school.timezone)) };
  });
}

export async function heartbeat(kiosk: KioskCaller, input: KioskHeartbeatRequest): Promise<{ serverTime: string }> {
  await withTenant({ schoolId: kiosk.schoolId, userId: null }, (tx) => recordHeartbeat(tx, kiosk.kioskId, { queueSize: input.queueSize, appVersion: input.appVersion ?? null }));
  return { serverTime: new Date().toISOString() };
}
