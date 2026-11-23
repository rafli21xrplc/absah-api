import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpWebhookSender, signWebhook, WebhookSendError, type Resolved, type Transport, type WebhookCall } from './webhook-sender';

const call = (url = 'https://hooks.sekolah.example/in?token=RAHASIA'): WebhookCall => ({ url, secret: 'whsec_test', deliveryId: 'd-1', eventType: 'leave.approved', body: '{"a":1}', timestamp: 1_800_000_000 });
const pub: Resolved = { address: '203.0.113.7', family: 4 };

function sender(addresses: Resolved[] | Error, status = 204) {
  const sent: Parameters<Transport>[0][] = [];
  const transport: Transport = (req) => {
    sent.push(req);
    return Promise.resolve(status);
  };
  const resolve = () => (addresses instanceof Error ? Promise.reject(addresses) : Promise.resolve(addresses));
  return { http: new HttpWebhookSender({ resolve, transport }), sent };
}

describe('signWebhook', () => {
  it('is t=<unix>,v1=<hmac sha256 of "<t>.<body>">, so a receiver can recompute it', () => {
    const expected = createHmac('sha256', 'whsec_test').update('1800000000.{"a":1}').digest('hex');
    expect(signWebhook('whsec_test', 1_800_000_000, '{"a":1}')).toBe(`t=1800000000,v1=${expected}`);
    expect(signWebhook('whsec_other', 1_800_000_000, '{"a":1}')).not.toBe(signWebhook('whsec_test', 1_800_000_000, '{"a":1}'));
    expect(signWebhook('whsec_test', 1_800_000_001, '{"a":1}')).not.toBe(signWebhook('whsec_test', 1_800_000_000, '{"a":1}'));
  });
});

describe('HttpWebhookSender', () => {
  it('connects to the address it checked, keeps the name for TLS, and sends the signed headers and path', async () => {
    const { http, sent } = sender([pub]);
    expect(await http.post(call())).toEqual({ status: 204 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ host: 'hooks.sekolah.example', address: pub, path: '/in?token=RAHASIA', body: '{"a":1}' });
    expect(sent[0]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Absah-Event': 'leave.approved',
      'X-Absah-Delivery': 'd-1',
      'X-Absah-Signature': signWebhook('whsec_test', 1_800_000_000, '{"a":1}'),
    });
  });

  it('passes any HTTP answer through; deciding what a status means is the consumer\'s job', async () => {
    expect(await sender([pub], 503).http.post(call())).toEqual({ status: 503 });
    expect(await sender([pub], 301).http.post(call())).toEqual({ status: 301 });
  });

  it('refuses a name that resolves to a private address, even when another answer is public', async () => {
    for (const addresses of [[{ address: '127.0.0.1', family: 4 }], [pub, { address: '10.0.0.8', family: 4 }], [{ address: '::1', family: 6 }], [{ address: '169.254.169.254', family: 4 }]] as Resolved[][]) {
      const { http, sent } = sender(addresses);
      await expect(http.post(call())).rejects.toMatchObject({ kind: 'blocked', retryable: false });
      expect(sent).toHaveLength(0);
    }
  });

  it('refuses an address that fails the URL rules before resolving anything, and never puts the address in the error', async () => {
    for (const url of ['http://hooks.example/in', 'https://localhost/in', 'https://192.168.0.5/in?token=RAHASIA', 'https://hooks.example:8443/in']) {
      const { http, sent } = sender([pub]);
      const err = await http.post(call(url)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebhookSendError);
      expect((err as WebhookSendError).kind).toBe('blocked');
      expect((err as WebhookSendError).message).not.toMatch(/RAHASIA|192\.168/);
      expect(sent).toHaveLength(0);
    }
  });

  it('a name that does not resolve now is retried later, not given up', async () => {
    for (const result of [new Error('ENOTFOUND'), [] as Resolved[]]) {
      const err = await sender(result).http.post(call()).catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'dns', retryable: true });
    }
  });

  it('a literal public IP needs no DNS answer to be allowed, a private literal is blocked', async () => {
    const { http, sent } = sender([{ address: '203.0.113.10', family: 4 }]);
    await http.post(call('https://203.0.113.10/in'));
    expect(sent[0]?.host).toBe('203.0.113.10');
    await expect(sender([pub]).http.post(call('https://10.1.1.1/in'))).rejects.toMatchObject({ kind: 'blocked' });
  });
});
