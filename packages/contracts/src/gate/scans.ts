import { z } from 'zod';
import { ArrivalOutcome, ScanRejectReason, ScanResult } from './enums';
import { KioskPickupStudent } from './pickup';

/** What a kiosk downloads each morning to work offline (GRB-03). */
export const KioskDay = z
  .object({
    schoolDate: z.iso.date(),
    timezone: z.string(),
    /** "HH:MM": an arrival after this is late (T). */
    lateAfter: z.string(),
    /** School-day keys (base64url) for today and tomorrow, for verifyCardToken offline. */
    keys: z.array(z.object({ schoolDate: z.iso.date(), key: z.string() })),
    /** Cards with a bound phone. Only the first name and rombel, for the feedback screen. */
    cards: z.array(z.object({ cardId: z.uuid(), deviceId: z.uuid(), firstName: z.string(), className: z.string() })),
    /** Approved penjemput per card (GRB-10); null when gate.pickup is off. */
    pickup: z.array(KioskPickupStudent).nullable(),
  })
  .meta({ id: 'KioskDay' });
export type KioskDay = z.infer<typeof KioskDay>;

export const KIOSK_SCAN_BATCH_MAX = 200;

/** POST /api/v1/kiosk/scans: queued scans, each with the kiosk's own event id (exactly once). */
export const KioskScanBatch = z
  .object({
    scans: z
      .array(z.object({ clientEventId: z.uuid(), token: z.string().max(200), scannedAt: z.iso.datetime({ offset: true }) }).strict())
      .min(1)
      .max(KIOSK_SCAN_BATCH_MAX),
  })
  .strict()
  .meta({ id: 'KioskScanBatch' });
export type KioskScanBatch = z.infer<typeof KioskScanBatch>;

export const KioskScanResult = z
  .object({
    clientEventId: z.uuid(),
    result: ScanResult,
    rejectReason: ScanRejectReason.nullable(),
    outcome: ArrivalOutcome.nullable(),
    firstName: z.string().nullable(),
  })
  .meta({ id: 'KioskScanResult' });
export type KioskScanResult = z.infer<typeof KioskScanResult>;

export const KioskScanResults = z.object({ results: z.array(KioskScanResult) }).meta({ id: 'KioskScanResults' });
export type KioskScanResults = z.infer<typeof KioskScanResults>;
