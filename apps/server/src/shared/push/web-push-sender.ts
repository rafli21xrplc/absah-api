import webpush from 'web-push';
import { PushError, type PushMessage, type PushSender, type PushTarget } from './push-sender';

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** A push that waits longer than this at the push service is useless (a visitor has left by then). */
const TTL_SECONDS = 60 * 60;

/** The real sender: Web Push with VAPID (RFC 8030, 8291, 8292) through the web-push library. */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: VapidDetails) {}

  async send(target: PushTarget, message: PushMessage): Promise<void> {
    try {
      await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(message), {
        vapidDetails: this.vapid,
        TTL: TTL_SECONDS,
        urgency: 'normal',
        timeout: 10_000,
      });
    } catch (err) {
      throw toPushError(err);
    }
  }
}

/** Maps the library's error to ours without keeping its text: it can quote the endpoint. */
export function toPushError(err: unknown): PushError {
  const status = typeof err === 'object' && err !== null && 'statusCode' in err ? Number(err.statusCode) : undefined;
  if (status === 404 || status === 410) return new PushError(`push subscription gone (${status})`, 'gone');
  if (status === undefined || status === 429 || status >= 500) return new PushError(`push service unavailable${status ? ` (${status})` : ''}`, 'retryable');
  return new PushError(`push refused (${status})`, 'failed');
}
