import { z } from 'zod';
import { PaymentMethod, PaymentStatus } from './enums';

/** POST /api/v1/billing/invoices/{invoiceId}/payments (admin): open a VA or QRIS for the invoice. */
export const CreatePaymentRequest = z.object({ method: PaymentMethod }).strict().meta({ id: 'CreatePaymentRequest' });
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequest>;

/**
 * A payment attempt. requested = the worker is opening it at the gateway (poll); pending = pay to
 * vaNumber or scan qrString before expiresAt; then paid, expired or failed.
 */
export const Payment = z
  .object({
    id: z.uuid(),
    invoiceId: z.uuid(),
    method: PaymentMethod,
    status: PaymentStatus,
    amount: z.int().nonnegative(),
    vaBank: z.string().nullable(),
    vaNumber: z.string().nullable(),
    qrString: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Payment' });
export type Payment = z.infer<typeof Payment>;

/** GET /api/v1/billing/invoices/{invoiceId}/payments: newest first. */
export const PaymentList = z.object({ items: z.array(Payment) }).meta({ id: 'PaymentList' });
export type PaymentList = z.infer<typeof PaymentList>;
