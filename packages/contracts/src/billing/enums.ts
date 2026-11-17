import { z } from 'zod';

/** Workspace billing (BIL): Absah's monthly invoice to a school. */
export const INVOICE_STATUSES = ['issued', 'paid', 'void'] as const;
export const InvoiceStatus = z.enum(INVOICE_STATUSES).meta({ id: 'InvoiceStatus' });
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const PAYMENT_METHODS = ['va', 'qris'] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS).meta({ id: 'PaymentMethod' });
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** requested: waiting for the worker to open it at the provider; pending: payable; then paid, expired or failed. */
export const PAYMENT_STATUSES = ['requested', 'pending', 'paid', 'expired', 'failed'] as const;
export const PaymentStatus = z.enum(PAYMENT_STATUSES).meta({ id: 'PaymentStatus' });
export type PaymentStatus = z.infer<typeof PaymentStatus>;
