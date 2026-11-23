import { anyRole } from '../../../shared/policy';

/** Manages DUDI partners and placements (PKL-01): humas PKL, wakasek, admin. */
export const canManagePkl = anyRole('admin', 'wakasek', 'humas_pkl');

/** Sees every placement and check-in; anyone else only those they supervise. */
export const canSeeAllPkl = anyRole('admin', 'wakasek', 'humas_pkl', 'kepsek');
