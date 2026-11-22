import { z } from 'zod';
import { FeeKind } from './constants';
import type { Role } from '../platform/roles';

/** TGH: the bendahara and admin run the fees; kepsek and wakasek read. The wali kelas has no view of money. */
export const BILLING_MANAGERS = ['bendahara', 'admin'] as const satisfies readonly Role[];
export const BILLING_READERS = ['bendahara', 'admin', 'kepsek', 'wakasek'] as const satisfies readonly Role[];

/** A fee in whole rupiah; the ceiling keeps a typo (an extra zero or three) from becoming a bill. */
const Rupiah = z.number().int().min(0).max(100_000_000);

export const FeeType = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: FeeKind,
    defaultAmount: z.number().int(),
    active: z.boolean(),
  })
  .meta({ id: 'FeeType' });
export type FeeType = z.infer<typeof FeeType>;

export const FeeTypeList = z.object({ items: z.array(FeeType) }).meta({ id: 'FeeTypeList' });
export type FeeTypeList = z.infer<typeof FeeTypeList>;

export const CreateFeeTypeRequest = z
  .object({
    name: z.string().trim().min(2, 'Nama jenis tagihan minimal 2 huruf.').max(80),
    kind: FeeKind,
    defaultAmount: Rupiah,
  })
  .meta({ id: 'CreateFeeTypeRequest' });
export type CreateFeeTypeRequest = z.infer<typeof CreateFeeTypeRequest>;

export const UpdateFeeTypeRequest = z
  .object({
    name: z.string().trim().min(2, 'Nama jenis tagihan minimal 2 huruf.').max(80).optional(),
    kind: FeeKind.optional(),
    defaultAmount: Rupiah.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Tidak ada yang diubah.' })
  .meta({ id: 'UpdateFeeTypeRequest' });
export type UpdateFeeTypeRequest = z.infer<typeof UpdateFeeTypeRequest>;

export const FeeTypeIdParam = z.object({ feeTypeId: z.uuid() });
export const FeeTypesQuery = z.object({ includeInactive: z.stringbool().default(false) });
export type FeeTypesQuery = z.infer<typeof FeeTypesQuery>;
