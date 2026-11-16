import { z } from 'zod';

/** Kiosk devices at the gate (GRB-02): paired with a one-time code, then a device token. */

/** Authorization header value prefix for kiosk calls: `Kiosk <deviceToken>`. */
export const KIOSK_AUTH_SCHEME = 'Kiosk';
export const KIOSK_PAIRING_TTL_MINUTES = 10;
/** A kiosk counts as online when its last heartbeat is newer than this. */
export const KIOSK_ONLINE_SECONDS = 150;

export const KioskPairing = z
  .object({ pairingCode: z.string(), expiresAt: z.iso.datetime({ offset: true }) })
  .meta({ id: 'KioskPairing' });
export type KioskPairing = z.infer<typeof KioskPairing>;

export const KioskDevice = z
  .object({
    id: z.uuid(),
    name: z.string(),
    online: z.boolean(),
    lastSeenAt: z.iso.datetime({ offset: true }).nullable(),
    lastQueueSize: z.int().nullable(),
    appVersion: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'KioskDevice' });
export type KioskDevice = z.infer<typeof KioskDevice>;

export const KioskDeviceList = z.object({ items: z.array(KioskDevice) }).meta({ id: 'KioskDeviceList' });
export type KioskDeviceList = z.infer<typeof KioskDeviceList>;

export const KioskIdParam = z.object({ kioskId: z.uuid() });

/** POST /api/v1/kiosk/pair (no session): the code from the admin screen (QR or typed). */
export const PairKioskRequest = z
  .object({
    pairingCode: z.string().trim().min(10).max(200),
    name: z.string().trim().min(1, 'Beri nama kios, mis. Gerbang depan.').max(60),
    appVersion: z.string().max(40).optional(),
  })
  .strict()
  .meta({ id: 'PairKioskRequest' });
export type PairKioskRequest = z.infer<typeof PairKioskRequest>;

export const PairKioskResponse = z
  .object({
    /** Send as `Authorization: Kiosk <deviceToken>`; shown once. */
    deviceToken: z.string(),
    kiosk: z.object({ id: z.uuid(), name: z.string() }),
    school: z.object({ id: z.uuid(), name: z.string(), timezone: z.string() }),
  })
  .meta({ id: 'PairKioskResponse' });
export type PairKioskResponse = z.infer<typeof PairKioskResponse>;

export const KioskHeartbeatRequest = z
  .object({ queueSize: z.int().min(0).max(100_000), appVersion: z.string().max(40).optional() })
  .strict()
  .meta({ id: 'KioskHeartbeatRequest' });
export type KioskHeartbeatRequest = z.infer<typeof KioskHeartbeatRequest>;

export const KioskHeartbeatResponse = z.object({ serverTime: z.iso.datetime({ offset: true }) }).meta({ id: 'KioskHeartbeatResponse' });
export type KioskHeartbeatResponse = z.infer<typeof KioskHeartbeatResponse>;
