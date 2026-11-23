import { z } from 'zod';

/** Why a student may not sit: the rule the school chose, with the student's own number. */
export const EligibilityReason = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('attendance'), percent: z.number(), minimum: z.number().int() }),
    /** Installments due on or before the first exam day that are still unpaid; how much is for the bendahara, not the wali kelas. */
    z.object({ kind: z.literal('bills'), unpaidInstallments: z.number().int() }),
  ])
  .meta({ id: 'EligibilityReason' });
export type EligibilityReason = z.infer<typeof EligibilityReason>;

export const EligibilityItem = z
  .object({
    enrollmentId: z.uuid(),
    student: z.object({ name: z.string() }),
    className: z.string(),
    eligible: z.boolean(),
    reasons: z.array(EligibilityReason),
  })
  .meta({ id: 'EligibilityItem' });
export type EligibilityItem = z.infer<typeof EligibilityItem>;

export const EligibilityQuery = z.object({
  classId: z.uuid().optional(),
  /** ineligible (default) lists only who may not sit; all lists every active student of the rombel. */
  show: z.enum(['ineligible', 'all']).default('ineligible'),
});
export type EligibilityQuery = z.infer<typeof EligibilityQuery>;

export const EligibilityList = z
  .object({
    period: z.object({ id: z.uuid(), name: z.string() }),
    items: z.array(EligibilityItem),
    /** Over every student in scope, whatever `show` hides. */
    counts: z.object({ students: z.number().int(), eligible: z.number().int(), ineligible: z.number().int() }),
  })
  .meta({ id: 'EligibilityList' });
export type EligibilityList = z.infer<typeof EligibilityList>;
