/** One browser's push subscription (decrypted), as the push service needs it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * What the staff phone shows. It appears on a lock screen, so it never carries a student's name
 * or anything else personal: "Tamu menunggu di gerbang", not who.
 */
export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped; a path of the web app, no personal data. */
  url: string;
  /** A newer message with the same tag replaces the older one on the phone. */
  tag?: string;
}

/**
 * gone: the browser unsubscribed or the subscription expired (404/410), drop it.
 * retryable: network, 429 or 5xx. failed: anything else (a bad key), do not retry.
 */
export class PushError extends Error {
  constructor(
    message: string,
    readonly kind: 'gone' | 'retryable' | 'failed',
  ) {
    super(message);
    this.name = 'PushError';
  }
}

export interface PushSender {
  /** Resolves when the push service accepted the message; throws PushError otherwise. Never log the target. */
  send(target: PushTarget, message: PushMessage): Promise<void>;
}

/** In memory (tests): records every message; `failing` makes chosen endpoints fail. */
export class FakePushSender implements PushSender {
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];
  readonly failing = new Map<string, PushError>();

  send(target: PushTarget, message: PushMessage): Promise<void> {
    const failure = this.failing.get(target.endpoint);
    if (failure) return Promise.reject(failure);
    this.sent.push({ target, message });
    return Promise.resolve();
  }
}
