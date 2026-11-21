import { z } from 'zod';

/** Subscriptions a staff member may hold per school (one per browser or phone); the oldest goes first. */
export const PUSH_MAX_PER_USER = 10;

/** GET /api/v1/push/config: the public VAPID key the browser subscribes with; null = push is off on this server. */
export const PushConfig = z.object({ publicKey: z.string().nullable() }).meta({ id: 'PushConfig' });
export type PushConfig = z.infer<typeof PushConfig>;

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'bukan base64url');

/** What PushSubscription.toJSON() gives the browser. */
export const PushSubscribeRequest = z
  .object({
    endpoint: z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(2048),
    keys: z.object({ p256dh: base64url.min(60).max(100), auth: base64url.min(16).max(32) }).strict(),
  })
  .strict()
  .meta({ id: 'PushSubscribeRequest' });
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequest>;

export const PushUnsubscribeRequest = z.object({ endpoint: z.url({ protocol: /^https$/ }).max(2048) }).strict().meta({ id: 'PushUnsubscribeRequest' });
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequest>;

/** Answer of subscribe and unsubscribe: how many devices of the caller receive push at this school. */
export const PushStatus = z.object({ devices: z.int().nonnegative() }).meta({ id: 'PushStatus' });
export type PushStatus = z.infer<typeof PushStatus>;
