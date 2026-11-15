import { z } from 'zod';
import { Role } from './roles';

/**
 * School levels. Mirrors LEVELS in @absah/capabilities; contracts must not depend on another
 * package because absah-app installs it from git (context.test.ts keeps the two in sync).
 */
export const SCHOOL_LEVELS = ['sd', 'smp', 'sma', 'smk'] as const;
export const SchoolLevel = z.enum(SCHOOL_LEVELS).meta({ id: 'SchoolLevel' });

export const SchoolIdHeader = z.uuid();

export const MeSchool = z
  .object({
    id: z.uuid(),
    name: z.string(),
    level: SchoolLevel,
    isMadrasah: z.boolean(),
    timezone: z.string(),
    roles: z.array(Role),
  })
  .meta({ id: 'MeSchool' });
export type MeSchool = z.infer<typeof MeSchool>;

/** GET /api/v1/me/context: who am I, which schools, and what can I do in the active one. */
export const MeContextResponse = z
  .object({
    user: z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string().nullable(),
      phoneNumber: z.string().nullable(),
      twoFactorEnabled: z.boolean(),
    }),
    schools: z.array(MeSchool),
    active: z
      .object({
        schoolId: z.uuid(),
        roles: z.array(Role),
        /** Filled from prompt 1.4 (capabilities). */
        capabilities: z.record(z.string(), z.unknown()),
      })
      .nullable(),
  })
  .meta({ id: 'MeContextResponse' });
export type MeContextResponse = z.infer<typeof MeContextResponse>;

/** GET /api/v1/school/members: members of the active school (admin, operator, kepsek, wakasek). */
export const SchoolMember = z
  .object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    role: Role,
    status: z.enum(['active', 'invited', 'suspended']),
    academicYearId: z.uuid().nullable(),
  })
  .meta({ id: 'SchoolMember' });

export const SchoolMembersResponse = z
  .object({ items: z.array(SchoolMember) })
  .meta({ id: 'SchoolMembersResponse' });
export type SchoolMembersResponse = z.infer<typeof SchoolMembersResponse>;
