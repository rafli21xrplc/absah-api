import { z } from 'zod';

/** What a fee is for; the school names its own fee types, this only groups them for the recap. */
export const FEE_KINDS = ['spp', 'kegiatan', 'lainnya'] as const;
export const FeeKind = z.enum(FEE_KINDS).meta({ id: 'FeeKind' });
export type FeeKind = z.infer<typeof FeeKind>;

/** open until every installment is paid; void when the school withdraws it (a bill is never deleted). */
export const BILL_STATUSES = ['open', 'paid', 'void'] as const;
export const BillStatus = z.enum(BILL_STATUSES).meta({ id: 'BillStatus' });
export type BillStatus = z.infer<typeof BillStatus>;

/** A bill split into more parts than this is a mistake, not a plan. */
export const MAX_INSTALLMENTS = 12;
