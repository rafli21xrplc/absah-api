import { PICKUP_PHOTO_TYPE, schoolDayKey, verifyCardToken, type CheckoutRejectReason, type KioskCheckoutBatch, type KioskCheckoutResult, type KioskPickupStudent } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { withTenant } from '../../../shared/db';
import { firstName } from '../../../shared/names';
import { emit } from '../../../shared/outbox';
import { schoolDate } from '../../../shared/school-date';
import type { ObjectStorage } from '../../../shared/storage';
import { eventsByClientId, guardianForCheckout, insertEvent, pickupRoster } from '../infrastructure/checkout-repo';
import { schoolSecret } from '../infrastructure/gate-secret-repo';
import { cardForScan } from '../infrastructure/scan-repo';
import type { KioskCaller } from './kiosks';

/** A kiosk clock more than this ahead of the server is not trusted. */
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

/** The kiosk's morning list: approved penjemput per card, photos behind 5-minute links. */
export async function kioskPickupRoster(tx: Tx, storage: ObjectStorage, date: string): Promise<KioskPickupStudent[]> {
  const byCard = new Map<string, KioskPickupStudent>();
  for (const r of await pickupRoster(tx, date)) {
    const link = await storage.presignDownload({ key: r.photoKey, contentType: PICKUP_PHOTO_TYPE });
    const student = byCard.get(r.cardId) ?? { cardId: r.cardId, guardians: [] };
    student.guardians.push({ id: r.id, name: r.name, relation: r.relation, photoUrl: link.url });
    byCard.set(r.cardId, student);
  }
  return [...byCard.values()];
}

export type VerifiedCard = { ok: true; cardId: string; studentId: string; enrollmentId: string; name: string; schoolDate: string } | { ok: false; reason: CheckoutRejectReason };

/** The card token as at the moment of the scan: signature, bound phone, active enrollment. */
export async function verifyCardAt(tx: Tx, kiosk: KioskCaller, token: string, at: Date, dayKeyFor: (d: string) => Promise<Uint8Array> | null): Promise<VerifiedCard> {
  if (at.getTime() > Date.now() + MAX_CLOCK_AHEAD_MS) return { ok: false, reason: 'expired' };
  const check = await verifyCardToken(token, at.getTime(), kiosk.timezone, dayKeyFor);
  if (!check.ok) return { ok: false, reason: check.reason };
  const card = await cardForScan(tx, check.cardId);
  if (!card) return { ok: false, reason: 'unknown_card' };
  if (card.activeDeviceId !== check.deviceId) return { ok: false, reason: 'wrong_device' };
  if (!card.enrollmentId) return { ok: false, reason: 'not_enrolled' };
  return { ok: true, cardId: card.cardId, studentId: card.studentId, enrollmentId: card.enrollmentId, name: card.name, schoolDate: check.schoolDate };
}

/** Day keys from the school secret, computed once per date of a batch. */
export async function dayKeysOf(tx: Tx, schoolId: string) {
  const secret = await schoolSecret(tx, schoolId);
  const cache = new Map<string, Promise<Uint8Array>>();
  return (d: string) => {
    if (!cache.has(d)) cache.set(d, schoolDayKey(secret, d));
    return cache.get(d) ?? null;
  };
}

/**
 * GRB-10: queued check-outs with a listed penjemput, exactly once per clientEventId (a resend gets
 * the same answer). The kiosk acted on its morning list, so a penjemput deactivated later that day
 * still counts; one never approved for this student does not. One release per student per day;
 * each release emits gate.checked_out (parents told).
 */
export function recordCheckouts(kiosk: KioskCaller, batch: KioskCheckoutBatch): Promise<{ results: KioskCheckoutResult[] }> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => {
    const dayKeyFor = await dayKeysOf(tx, kiosk.schoolId);
    const known = async (ids: string[]) => new Map((await eventsByClientId(tx, ids)).map((r) => [r.clientEventId, r]));
    const earlier = await known(batch.checkouts.map((c) => c.clientEventId));
    const results: KioskCheckoutResult[] = [];
    for (const c of batch.checkouts) {
      const done = earlier.get(c.clientEventId);
      if (done) {
        results.push({ clientEventId: c.clientEventId, result: done.status === 'released' ? 'released' : 'duplicate', rejectReason: null, firstName: firstName(done.name) });
        continue;
      }
      const reject = (reason: CheckoutRejectReason): KioskCheckoutResult => ({ clientEventId: c.clientEventId, result: 'rejected', rejectReason: reason, firstName: null });
      const at = new Date(c.checkedOutAt);
      const card = await verifyCardAt(tx, kiosk, c.token, at, dayKeyFor);
      if (!card.ok) {
        results.push(reject(card.reason));
        continue;
      }
      const guardian = await guardianForCheckout(tx, c.pickupGuardianId);
      const authorized =
        guardian?.studentId === card.studentId && guardian.decidedAt !== null && (guardian.status === 'approved' || guardian.status === 'inactive') && (guardian.validUntil === null || guardian.validUntil >= card.schoolDate);
      if (!guardian || !authorized) {
        results.push(reject('not_authorized'));
        continue;
      }
      const id = uuidv7();
      const inserted = await insertEvent(tx, {
        id,
        schoolId: kiosk.schoolId,
        schoolDate: schoolDate(kiosk.timezone, at),
        clientEventId: c.clientEventId,
        kioskId: kiosk.kioskId,
        studentId: card.studentId,
        enrollmentId: card.enrollmentId,
        pickupGuardianId: guardian.id,
        pickupName: guardian.name,
        status: 'released',
        checkedOutAt: at,
      });
      if (inserted) await emit(tx, 'gate.checked_out', { pickupEventId: id });
      const again = inserted ? undefined : (await known([c.clientEventId])).get(c.clientEventId);
      results.push({ clientEventId: c.clientEventId, result: inserted || again?.status === 'released' ? 'released' : 'duplicate', rejectReason: null, firstName: firstName(card.name) });
    }
    return { results };
  });
}
