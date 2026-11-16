import { z } from 'zod';
import { CardHolder } from './enums';

/** Digital cards on the holder's phone (GRB-01). The portal / PWA siswa (3.3) shows them. */

/** Day keys a bound phone receives at once, so its card works a week without signal. */
export const DEVICE_KEY_DAYS = 7;

/** GET /api/v1/cards/mine: the cards this user holds (own card, or children's for parents). */
export const MyCards = z
  .object({
    holder: CardHolder,
    items: z.array(z.object({ studentId: z.uuid(), name: z.string(), className: z.string(), cardId: z.uuid().nullable(), hasDevice: z.boolean() })),
  })
  .meta({ id: 'MyCards' });
export type MyCards = z.infer<typeof MyCards>;

/** POST /api/v1/cards/devices: bind this phone to a student's card (ends the previous phone). */
export const BindCardDeviceRequest = z
  .object({ studentId: z.uuid(), label: z.string().trim().max(60).optional() })
  .strict()
  .meta({ id: 'BindCardDeviceRequest' });
export type BindCardDeviceRequest = z.infer<typeof BindCardDeviceRequest>;

export const CardDeviceKeys = z
  .object({
    cardId: z.uuid(),
    deviceId: z.uuid(),
    timezone: z.string(),
    /** base64url HMAC keys per school date; make tokens with makeCardToken. */
    keys: z.array(z.object({ schoolDate: z.iso.date(), key: z.string() })),
  })
  .meta({ id: 'CardDeviceKeys' });
export type CardDeviceKeys = z.infer<typeof CardDeviceKeys>;

export const DeviceIdParam = z.object({ deviceId: z.uuid() });
