import type { PaymentMethod } from '@absah/contracts';

/**
 * Payment gateway behind an interface (docs/architecture.md "Integrasi"): VA / QRIS for Absah's
 * invoices (BIL) and later student bills (TGH). Adapters live here; use cases see only this.
 */
export interface ChargeRequest {
  /** Our payment id: the provider's external id, so a retried create returns the same charge. */
  reference: string;
  amount: number;
  method: PaymentMethod;
  description: string;
  expiresAt: Date;
}

export interface Charge {
  providerRef: string;
  vaBank: string | null;
  vaNumber: string | null;
  qrString: string | null;
  expiresAt: Date;
}

/** One verified webhook event: money arrived (paid) or the charge ended without it. */
export interface PaymentEvent {
  providerRef: string;
  /** Provider id of this event's transaction; dedup key in the inbox and in payments. */
  providerTxnId: string;
  status: 'paid' | 'expired' | 'failed';
  amount: number;
  at: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createCharge(input: ChargeRequest): Promise<Charge>;
  /** Signature check over the raw body; false = reject with 401. */
  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  /** Events in a verified body; unknown shapes give none. */
  parseWebhook(body: unknown): PaymentEvent[];
}

/** retryable: network, 429, 5xx (the consumer throws and retries); otherwise final. */
export class PaymentError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`payment provider error: ${code}`);
  }
}
