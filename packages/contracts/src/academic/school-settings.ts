import { z } from 'zod';
import { CapabilityMap, CapabilityValue, SchoolLevel } from '../platform/context';

/** PATCH /api/v1/school/profile (admin). Changing the level re-applies presets; overrides stay. */
export const UpdateSchoolProfileRequest = z
  .object({ level: SchoolLevel.optional(), isMadrasah: z.boolean().optional() })
  .strict()
  .refine((v) => v.level !== undefined || v.isMadrasah !== undefined, { message: 'Isi level atau isMadrasah.' })
  .meta({ id: 'UpdateSchoolProfileRequest' });
export type UpdateSchoolProfileRequest = z.infer<typeof UpdateSchoolProfileRequest>;

export const SchoolProfileResponse = z
  .object({ level: SchoolLevel, isMadrasah: z.boolean(), capabilities: CapabilityMap })
  .meta({ id: 'SchoolProfileResponse' });
export type SchoolProfileResponse = z.infer<typeof SchoolProfileResponse>;

/** One row of the capability settings screen. */
export const CapabilitySetting = z
  .object({
    key: z.string(),
    kind: z.enum(['bool', 'enum']),
    /** Allowed values of an enum capability; null for bool. */
    options: z.array(z.string()).nullable(),
    /** Value from the school profile (level preset + madrasah overlay). */
    preset: CapabilityValue,
    /** School override in force today; null = preset. */
    override: CapabilityValue.nullable(),
    /** Scheduled change (attendance.mode): value null = back to preset. */
    pending: z.object({ value: CapabilityValue.nullable(), effectiveFrom: z.iso.date() }).nullable(),
    /** Set by Absah (incident or rollout); the school cannot change it while set. */
    killSwitch: CapabilityValue.nullable(),
    /** Changes take effect the next school day. */
    deferred: z.boolean(),
    effective: CapabilityValue,
  })
  .meta({ id: 'CapabilitySetting' });
export type CapabilitySetting = z.infer<typeof CapabilitySetting>;

export const SchoolCapabilitiesResponse = z
  .object({ items: z.array(CapabilitySetting) })
  .meta({ id: 'SchoolCapabilitiesResponse' });
export type SchoolCapabilitiesResponse = z.infer<typeof SchoolCapabilitiesResponse>;

/** PUT /api/v1/school/capabilities: partial; null removes the override (back to preset). */
export const UpdateSchoolCapabilitiesRequest = z
  .object({
    values: z
      .record(z.string(), CapabilityValue.nullable())
      .refine((v) => Object.keys(v).length > 0, { message: 'Isi minimal satu capability.' }),
  })
  .strict()
  .meta({ id: 'UpdateSchoolCapabilitiesRequest' });
export type UpdateSchoolCapabilitiesRequest = z.infer<typeof UpdateSchoolCapabilitiesRequest>;
