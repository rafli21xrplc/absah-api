import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { isPrivateAddress, webhookUrlProblem } from '../domain/webhook-url';

/** What one webhook call is. The body is already the JSON text that gets signed and sent. */
export interface WebhookCall {
  url: string;
  secret: string;
  /** Our delivery id: the receiver may use it to drop repeats (we resend after a crash between their answer and our commit). */
  deliveryId: string;
  eventType: string;
  body: string;
  /** Unix seconds, signed together with the body so an old capture cannot be replayed later. */
  timestamp: number;
}

/**
 * blocked: the address is not allowed (never retried). dns: the name did not resolve now (retried). network: connection, TLS or
 * timeout (retried). Messages never carry the address: it may hold a token.
 */
export class WebhookSendError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'dns' | 'network',
  ) {
    super(message);
    this.name = 'WebhookSendError';
  }
  get retryable(): boolean {
    return this.kind !== 'blocked';
  }
}

export interface WebhookSender {
  /** Resolves with the HTTP status of any answer; throws WebhookSendError when there was none. Never follows redirects. */
  post(call: WebhookCall): Promise<{ status: number }>;
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the endpoint secret>`. Receivers recompute it and compare. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** In memory (tests): records every call; `answers` maps a URL host to the status to answer (default 200) or an error to throw. */
export class FakeWebhookSender implements WebhookSender {
  readonly calls: WebhookCall[] = [];
  readonly answers = new Map<string, number | WebhookSendError>();
  post(call: WebhookCall): Promise<{ status: number }> {
    this.calls.push(call);
    const answer = this.answers.get(new URL(call.url).hostname) ?? 200;
    return answer instanceof WebhookSendError ? Promise.reject(answer) : Promise.resolve({ status: answer });
  }
}

export interface Resolved {
  address: string;
  family: 4 | 6;
}

/** One HTTPS POST to an already validated address. Separate so the guard around it can be tested without a network. */
export type Transport = (req: { host: string; address: Resolved; path: string; headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<number>;

const httpsTransport: Transport = ({ host, address, path, headers, body, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        host, // certificate name and SNI
        port: 443,
        path,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        signal: AbortSignal.timeout(timeoutMs),
        // Connect to the address we checked, not to whatever the name points at a moment later (DNS rebinding).
        lookup: (_name, options, cb) => {
          if (options.all) cb(null, [{ address: address.address, family: address.family }]);
          else cb(null, address.address, address.family);
        },
      },
      (res) => {
        res.resume(); // the answer body is of no use to us
        resolve(res.statusCode ?? 0);
        res.destroy();
      },
    );
    req.on('error', (err) => reject(new WebhookSendError(`webhook request failed (${(err as NodeJS.ErrnoException).code ?? 'error'})`, 'network')));
    req.end(body);
  });

export interface HttpSenderOptions {
  timeoutMs?: number;
  resolve?: (host: string) => Promise<Resolved[]>;
  transport?: Transport;
}

const systemResolve = async (host: string): Promise<Resolved[]> =>
  (await dnsLookup(host, { all: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/**
 * The real sender. Before every call (not just at registration): the address must still pass the URL rules, the name is
 * resolved here, EVERY resolved address must be public (one private answer refuses the call), and the connection goes to the
 * address we checked. HTTPS on 443 only, no redirects, 5 s timeout.
 */
export class HttpWebhookSender implements WebhookSender {
  private readonly timeoutMs: number;
  private readonly resolveHost: (host: string) => Promise<Resolved[]>;
  private readonly transport: Transport;

  constructor(options: HttpSenderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.resolveHost = options.resolve ?? systemResolve;
    this.transport = options.transport ?? httpsTransport;
  }

  async post(call: WebhookCall): Promise<{ status: number }> {
    if (webhookUrlProblem(call.url)) throw new WebhookSendError('webhook address not allowed', 'blocked');
    const url = new URL(call.url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: Resolved[];
    try {
      addresses = await this.resolveHost(host);
    } catch {
      throw new WebhookSendError('webhook host did not resolve', 'dns');
    }
    const first = addresses[0];
    if (!first) throw new WebhookSendError('webhook host did not resolve', 'dns');
    if (addresses.some((a) => isPrivateAddress(a.address))) throw new WebhookSendError('webhook host resolves to a private address', 'blocked');

    const status = await this.transport({
      host,
      address: first,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Absah-Webhooks/1',
        'X-Absah-Event': call.eventType,
        'X-Absah-Delivery': call.deliveryId,
        'X-Absah-Signature': signWebhook(call.secret, call.timestamp, call.body),
      },
      body: call.body,
      timeoutMs: this.timeoutMs,
    });
    return { status };
  }
}
