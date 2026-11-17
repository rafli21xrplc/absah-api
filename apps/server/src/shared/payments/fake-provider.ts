import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Charge, ChargeRequest, PaymentEvent, PaymentProvider } from './payment-provider';
import { PaymentError } from './payment-provider';

export const FAKE_SIGNATURE_HEADER = 'x-absah-signature';

const FakeWebhook = z.object({
  events: z.array(
    z.object({
      providerRef: z.string().min(1),
      providerTxnId: z.string().min(1),
      status: z.enum(['paid', 'expired', 'failed']),
      amount: z.int().nonnegative(),
      at: z.iso.datetime(),
    }),
  ),
});

/** "sha256=<hex>" of the raw body: what the fake gateway (tests, e2e, dev) sends. */
export function signFakeWebhook(raw: string | Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

/**
 * Dev/test gateway: deterministic VA numbers and QR strings from our reference, webhooks signed with
 * PAYMENT_WEBHOOK_SECRET. Never allowed in production (config). failures queue errors for tests.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly charges: ChargeRequest[] = [];
  readonly failures: PaymentError[] = [];

  constructor(private readonly secret: string) {}

  createCharge(input: ChargeRequest): Promise<Charge> {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    this.charges.push(input);
    const digits = BigInt(`0x${input.reference.replace(/-/g, '').slice(-12)}`).toString().slice(-10).padStart(10, '0');
    return Promise.resolve({
      providerRef: `fake-${input.reference}`,
      vaBank: input.method === 'va' ? 'BNI' : null,
      vaNumber: input.method === 'va' ? `988${digits}` : null,
      qrString: input.method === 'qris' ? `00020101021226FAKEQRIS${digits}5303360540${input.amount}6304FAKE` : null,
      expiresAt: input.expiresAt,
    });
  }

  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const given = headers[FAKE_SIGNATURE_HEADER];
    if (typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(signFakeWebhook(raw, this.secret));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): PaymentEvent[] {
    const parsed = FakeWebhook.safeParse(body);
    return parsed.success ? parsed.data.events.map((e) => ({ ...e, at: new Date(e.at) })) : [];
  }
}

export { PaymentError };
