import { z } from 'zod';
import { CapabilityMap, CapabilityValue, SchoolLevel } from '../platform/context';

/** Indonesian time zones a school can be in (WIB, WITA, WIT). */
export const SCHOOL_TIMEZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'] as const;
export const SchoolTimezone = z.enum(SCHOOL_TIMEZONES).meta({ id: 'SchoolTimezone' });

/** NPSN: 8 digits (Kemendikdasmen). NSM: 12 digits (Kemenag, madrasah). */
export const Npsn = z.string().regex(/^\d{8}$/, 'NPSN terdiri dari 8 angka.');
export const Nsm = z.string().regex(/^\d{12}$/, 'NSM terdiri dari 12 angka.');

export const SchoolProfile = z
  .object({
    name: z.string(),
    npsn: z.string().nullable(),
    nsm: z.string().nullable(),
    timezone: z.string(),
    level: SchoolLevel,
    isMadrasah: z.boolean(),
  })
  .meta({ id: 'SchoolProfile' });
export type SchoolProfile = z.infer<typeof SchoolProfile>;

/**
 * PATCH /api/v1/school/profile (admin), partial. Changing the level re-applies presets; overrides
 * stay. npsn/nsm null clears the identifier.
 */
export const UpdateSchoolProfileRequest = z
  .object({
    name: z.string().trim().min(3, 'Nama sekolah minimal 3 huruf.').max(120).optional(),
    npsn: Npsn.nullable().optional(),
    nsm: Nsm.nullable().optional(),
    timezone: SchoolTimezone.optional(),
    level: SchoolLevel.optional(),
    isMadrasah: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Isi minimal satu data.' })
  .meta({ id: 'UpdateSchoolProfileRequest' });
export type UpdateSchoolProfileRequest = z.infer<typeof UpdateSchoolProfileRequest>;

export const SchoolProfileResponse = SchoolProfile.extend({ capabilities: CapabilityMap }).meta({
  id: 'SchoolProfileResponse',
});
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

/** Wizard steps (PLT-12), in order. profile and level are required to finish. */
export const SETUP_STEPS = ['profile', 'level', 'mbg', 'import', 'gate', 'invite'] as const;
export const SetupStep = z.enum(SETUP_STEPS).meta({ id: 'SetupStep' });
export type SetupStep = z.infer<typeof SetupStep>;
export const REQUIRED_SETUP_STEPS: readonly SetupStep[] = ['profile', 'level'];

export const SetupStepStatus = z.enum(['todo', 'done', 'skipped']).meta({ id: 'SetupStepStatus' });

/** GET /api/v1/school/setup: where the admin left the wizard. */
export const SchoolSetupResponse = z
  .object({
    steps: z.array(z.object({ id: SetupStep, status: SetupStepStatus })),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    profile: SchoolProfile,
  })
  .meta({ id: 'SchoolSetupResponse' });
export type SchoolSetupResponse = z.infer<typeof SchoolSetupResponse>;

export const SetupStepParam = z.object({ step: SetupStep });

/** PUT /api/v1/school/setup/steps/{step}. Required steps cannot be skipped. */
export const UpdateSetupStepRequest = z
  .object({ status: z.enum(['done', 'skipped']) })
  .strict()
  .meta({ id: 'UpdateSetupStepRequest' });
export type UpdateSetupStepRequest = z.infer<typeof UpdateSetupStepRequest>;
