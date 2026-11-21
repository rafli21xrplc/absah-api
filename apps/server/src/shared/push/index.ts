import type { Config } from '../config';
import { type PushSender } from './push-sender';
import { WebPushSender } from './web-push-sender';

export { FakePushSender, PushError, type PushMessage, type PushSender, type PushTarget } from './push-sender';
export { toPushError, WebPushSender } from './web-push-sender';

/** The Web Push sender when the VAPID keys are configured, else null: push is off and nothing is sent. */
export function createPushSender(config: Config): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) return null;
  return new WebPushSender({ subject: config.VAPID_SUBJECT, publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY });
}
