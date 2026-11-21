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
  'guru_bk',
  'guru_tahfidz',
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

/** Roles an admin can invite as staff (parents and students join through their own flows). */
export const STAFF_ROLES = ROLES.filter((r): r is Exclude<Role, 'orang_tua' | 'siswa'> => r !== 'orang_tua' && r !== 'siswa');
export const StaffRole = z.enum(STAFF_ROLES as [Exclude<Role, 'orang_tua' | 'siswa'>, ...Exclude<Role, 'orang_tua' | 'siswa'>[]]).meta({ id: 'StaffRole' });
export type StaffRole = z.infer<typeof StaffRole>;
