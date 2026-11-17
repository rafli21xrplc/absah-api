import type { Config } from '../config';
import { FakePaymentProvider } from './fake-provider';
import type { PaymentProvider } from './payment-provider';

export * from './payment-provider';
export { FAKE_SIGNATURE_HEADER, FakePaymentProvider, signFakeWebhook } from './fake-provider';

/**
 * PAYMENT_PROVIDER: none = online payment off (the API answers 409 payments_unavailable);
 * fake = dev/test gateway (refused in production). A real gateway adapter comes with its sandbox account.
 */
export function createPaymentProvider(config: Config): PaymentProvider | null {
  if (config.PAYMENT_PROVIDER === 'fake') return new FakePaymentProvider(config.PAYMENT_WEBHOOK_SECRET ?? '');
  return null;
}
