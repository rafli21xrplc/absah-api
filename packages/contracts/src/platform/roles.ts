import { z } from 'zod';

/** Roles are per school (and, for teaching roles, per academic year). docs/architecture.md "Akses dan peran". */
export const ROLES = [
  'admin',
  'operator',
  'kepsek',
  'wakasek',
  'wali_kelas',
  'guru',
  'piket',
  'petugas_uks',
  'tppk',
  'pembina',
  'humas_pkl',
  'pembimbing_pkl',
  'pembimbing_industri',
  'orang_tua',
  'siswa',
] as const;

export const Role = z.enum(ROLES).meta({ id: 'Role' });
export type Role = z.infer<typeof Role>;

/** Roles that must have TOTP two-factor enabled before they can act in a school (PLT-01). */
export const TWO_FACTOR_REQUIRED_ROLES: readonly Role[] = ['admin', 'operator'];

export const MEMBERSHIP_STATUSES = ['active', 'invited', 'suspended'] as const;
export const MembershipStatus = z.enum(MEMBERSHIP_STATUSES).meta({ id: 'MembershipStatus' });
export type MembershipStatus = z.infer<typeof MembershipStatus>;
