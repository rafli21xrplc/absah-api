import { schoolDayKey, toBase64Url, verifyCardToken, type KioskDay, type KioskScanBatch, type KioskScanResult, type ScanRejectReason } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { withTenant } from '../../../shared/db';
import { addDays, schoolDate, schoolMinutes } from '../../../shared/school-date';
import { applyGateArrivals, schoolStartTime } from '../../attendance';
import { firstName } from '../../../shared/names';
import type { ObjectStorage } from '../../../shared/storage';
import { kioskPickupRoster } from './checkouts';
import { dayKeys, schoolSecret } from '../infrastructure/gate-secret-repo';
import { cardForScan, insertScan, kioskRoster, knownScans, type ScanRow } from '../infrastructure/scan-repo';
import type { KioskCaller } from './kiosks';

/** A kiosk clock more than this ahead of the server is not trusted. */
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Today's offline kit; with gate.pickup also the approved penjemput per card (GRB-10). */
export function kioskDay(kiosk: KioskCaller, storage: ObjectStorage): Promise<KioskDay> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => {
    const today = schoolDate(kiosk.timezone);
    const keys = await dayKeys(tx, kiosk.schoolId, [today, addDays(today, 1)]);
    const cards = (await kioskRoster(tx)).flatMap((r) => (r.deviceId ? [{ cardId: r.cardId, deviceId: r.deviceId, firstName: firstName(r.name), className: r.className }] : []));
    return {
      schoolDate: today,
      timezone: kiosk.timezone,
      lateAfter: await schoolStartTime(tx, today),
      keys: [...keys].map(([d, key]) => ({ schoolDate: d, key: toBase64Url(key) })),
      cards,
      pickup: kiosk.caps['gate.pickup'] ? await kioskPickupRoster(tx, storage, today) : null,
    };
  });
}

type Scan = KioskScanBatch['scans'][number];

/**
 * Records a batch of queued scans exactly once per client event: a retried batch gets the stored
 * answers. The first valid scan of a student per day is the arrival (on time or late) and marks
 * attendance (source gate) right away; later ones are duplicates.
 */
export function recordScans(kiosk: KioskCaller, batch: KioskScanBatch): Promise<{ results: KioskScanResult[] }> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => {
    const secret = await schoolSecret(tx, kiosk.schoolId);
    const dayKeyCache = new Map<string, Promise<Uint8Array>>();
    const dayKeyFor = (d: string) => {
      if (!dayKeyCache.has(d)) dayKeyCache.set(d, schoolDayKey(secret, d));
      return dayKeyCache.get(d) ?? null;
    };
    const startCache = new Map<string, string>();
    const lateAfter = async (d: string) => {
      if (!startCache.has(d)) startCache.set(d, await schoolStartTime(tx, d));
      return minutes(startCache.get(d) ?? '07:00');
    };

    const stored = async (clientEventId: string): Promise<KioskScanResult | null> => {
      const [row] = await knownScans(tx, kiosk.kioskId, [clientEventId]);
      return row ? { clientEventId, result: row.result, rejectReason: row.rejectReason, outcome: row.outcome, firstName: row.name ? firstName(row.name) : null } : null;
    };
    const known = new Map((await knownScans(tx, kiosk.kioskId, batch.scans.map((s) => s.clientEventId))).map((r) => [r.clientEventId, r]));

    const results: KioskScanResult[] = [];
    for (const scan of batch.scans) {
      const earlier = known.get(scan.clientEventId);
      if (earlier) {
        results.push({ clientEventId: scan.clientEventId, result: earlier.result, rejectReason: earlier.rejectReason, outcome: earlier.outcome, firstName: earlier.name ? firstName(earlier.name) : null });
        continue;
      }
      results.push(await recordOne(tx, kiosk, scan, dayKeyFor, lateAfter, stored));
    }
    return { results };
  });
}

async function recordOne(
  tx: Tx,
  kiosk: KioskCaller,
  scan: Scan,
  dayKeyFor: (d: string) => Promise<Uint8Array> | null,
  lateAfter: (d: string) => Promise<number>,
  stored: (clientEventId: string) => Promise<KioskScanResult | null>,
): Promise<KioskScanResult> {
  const scannedAt = new Date(scan.scannedAt);
  const base = { schoolId: kiosk.schoolId, scannedAt, method: 'qr' as const, kioskDeviceId: kiosk.kioskId, clientEventId: scan.clientEventId };
  const reject = async (reason: ScanRejectReason, extra: Partial<ScanRow> = {}): Promise<KioskScanResult> => {
    const row = { ...base, schoolDate: schoolDate(kiosk.timezone, scannedAt), result: 'rejected' as const, rejectReason: reason, ...extra };
    if (!(await insertScan(tx, row))) return (await stored(scan.clientEventId)) ?? { clientEventId: scan.clientEventId, result: 'rejected', rejectReason: reason, outcome: null, firstName: null };
    return { clientEventId: scan.clientEventId, result: 'rejected', rejectReason: reason, outcome: null, firstName: null };
  };

  if (scannedAt.getTime() > Date.now() + MAX_CLOCK_AHEAD_MS) return reject('expired');
  const check = await verifyCardToken(scan.token, scannedAt.getTime(), kiosk.timezone, dayKeyFor);
  if (!check.ok) return reject(check.reason);
  const ids = { cardId: check.cardId, deviceId: check.deviceId };
  const card = await cardForScan(tx, check.cardId);
  if (!card) return reject('unknown_card', { deviceId: check.deviceId });
  if (card.activeDeviceId !== check.deviceId) return reject('wrong_device', ids);
  if (!card.enrollmentId) return reject('not_enrolled', ids);

  const outcome = schoolMinutes(kiosk.timezone, scannedAt) <= (await lateAfter(check.schoolDate)) ? ('on_time' as const) : ('late' as const);
  const name = firstName(card.name);
  const row = { ...base, ...ids, schoolDate: check.schoolDate, enrollmentId: card.enrollmentId };
  if (await insertScan(tx, { ...row, result: 'accepted', outcome })) {
    await applyGateArrivals(tx, kiosk.schoolId, kiosk.timezone, { schoolDate: check.schoolDate, enrollmentId: card.enrollmentId });
    return { clientEventId: scan.clientEventId, result: 'accepted', rejectReason: null, outcome, firstName: name };
  }
  const again = await stored(scan.clientEventId);
  if (again) return again;
  await insertScan(tx, { ...row, result: 'duplicate' });
  return { clientEventId: scan.clientEventId, result: 'duplicate', rejectReason: null, outcome: null, firstName: name };
}
