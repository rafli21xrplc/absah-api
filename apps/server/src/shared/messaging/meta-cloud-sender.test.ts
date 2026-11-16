import { describe, expect, it } from 'vitest';
import { SendError } from './message-sender';
import { MetaCloudSender } from './meta-cloud-sender';

const config = { apiUrl: 'https://wa.test/v21.0', phoneNumberId: '123', accessToken: 'tok', otpTemplate: { name: 'absah_login_otp_v1', language: 'id' } };
const message = { to: '+6281234567890', template: { name: 'absah_absent_marked_v1', language: 'id' }, params: ['SDN 1', 'Ani', '16 Nov', 'https://x'], text: 'unused' };

type Seen = { url: string; body: string; headers: Headers };

function fakeFetch(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return (url, init) => {
    seen.push({ url: url instanceof Request ? url.url : url.toString(), body: typeof init?.body === 'string' ? init.body : '', headers: new Headers(init?.headers) });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  };
}

describe('MetaCloudSender', () => {
  it('posts a template message with body parameters and returns the message id', async () => {
    const seen: Seen[] = [];
    const sender = new MetaCloudSender(config, fakeFetch(200, { messages: [{ id: 'wamid.1' }] }, seen));
    expect(await sender.sendTemplate(message)).toEqual({ providerMessageId: 'wamid.1' });
    expect(seen[0]?.url).toBe('https://wa.test/v21.0/123/messages');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({
      messaging_product: 'whatsapp',
      to: '6281234567890',
      type: 'template',
      template: {
        name: 'absah_absent_marked_v1',
        language: { code: 'id' },
        components: [{ type: 'body', parameters: message.params.map((text) => ({ type: 'text', text })) }],
      },
    });
  });

  it('sends the OTP through the authentication template (body + copy-code button)', async () => {
    const seen: Seen[] = [];
    await new MetaCloudSender(config, fakeFetch(200, { messages: [{ id: 'wamid.2' }] }, seen)).sendOtp({ to: '+628111', code: '123456', purpose: 'login' });
    const body = JSON.parse(seen[0]?.body ?? '') as { template: { name: string; components: { type: string }[] } };
    expect(body.template.name).toBe('absah_login_otp_v1');
    expect(body.template.components.map((c) => c.type)).toEqual(['body', 'button']);
  });

  it('marks rate limits, 5xx and network errors retryable, other errors final', async () => {
    const fail = async (f: typeof fetch) => new MetaCloudSender(config, f).sendTemplate(message).catch((e: unknown) => e);
    expect(await fail(fakeFetch(429, { error: { code: 130429 } }))).toMatchObject({ code: 'http_429:130429', retryable: true });
    expect(await fail(fakeFetch(503, {}))).toMatchObject({ retryable: true });
    expect(await fail(fakeFetch(400, { error: { code: 132001 } }))).toMatchObject({ code: 'http_400:132001', retryable: false });
    const offline = await fail(() => Promise.reject(new TypeError('fetch failed')));
    expect(offline).toBeInstanceOf(SendError);
    expect(offline).toMatchObject({ code: 'network', retryable: true });
  });
});
