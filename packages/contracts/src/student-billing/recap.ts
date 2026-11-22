import { z } from 'zod';

/** TGH-04: what came in during a month and what is still owed; for the bendahara, kepsek, wakasek and admin. */
export const BillingRecapQuery = z.object({
  /** YYYY-MM; defaults to the current month on the school's clock. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Bulan harus YYYY-MM.').optional(),
  feeTypeId: z.uuid().optional(),
});
export type BillingRecapQuery = z.infer<typeof BillingRecapQuery>;

export const BillingRecap = z
  .object({
    month: z.string(),
    /** Money that arrived in the month (payments marked paid by the gateway), whatever bill it was for. */
    received: z.object({
      count: z.number().int(),
      amount: z.number().int(),
      va: z.number().int(),
      qris: z.number().int(),
      /** Payments that arrived but counted for nothing (the installment was already paid, or the bill voided): the bendahara looks at them. */
      flagged: z.number().int(),
      days: z.array(z.object({ date: z.string(), count: z.number().int(), amount: z.number().int() })),
    }),
    /** All bills that are not void, as of today. */
    bills: z.object({
      count: z.number().int(),
      billed: z.number().int(),
      paid: z.number().int(),
      outstanding: z.number().int(),
      /** Rupiah of unpaid installments past their due date, on open bills. */
      overdue: z.number().int(),
      classes: z.array(z.object({ classId: z.uuid(), className: z.string(), count: z.number().int(), billed: z.number().int(), paid: z.number().int(), outstanding: z.number().int(), overdue: z.number().int() })),
    }),
  })
  .meta({ id: 'BillingRecap' });
export type BillingRecap = z.infer<typeof BillingRecap>;
