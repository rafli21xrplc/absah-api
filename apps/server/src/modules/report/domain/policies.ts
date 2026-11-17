import { anyRole } from '../../../shared/policy';

/** Sees the rekap of every rombel; others see only rombel where they are wali kelas. */
export const canReadAllRecaps = anyRole('admin', 'operator', 'kepsek', 'wakasek');
/** Session filling compliance (RKP-04). */
export const canReadCompliance = anyRole('admin', 'kepsek', 'wakasek');
/** Jumlah hadir MBG (RKP-08): reading the numbers; only admin changes settings or corrects them. */
export const canReadMbg = anyRole('admin', 'operator', 'kepsek', 'wakasek');
export const canManageMbg = anyRole('admin');
