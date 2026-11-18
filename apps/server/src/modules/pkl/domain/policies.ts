import { anyRole } from '../../../shared/policy';

/** Manages DUDI partners and placements (PKL-01): humas PKL, wakasek, admin. */
export const canManagePkl = anyRole('admin', 'wakasek', 'humas_pkl');

/** Sees every placement and check-in; anyone else only those they supervise. */
export const canSeeAllPkl = anyRole('admin', 'wakasek', 'humas_pkl', 'kepsek');

/** Checks in at the DUDI from the PWA (PKL-02): the student's own login. */
export const canCheckIn = anyRole('siswa');

/** Confirms and disputes check-ins of the students at their place (PKL-02); rows filter by industry_mentor_id. */
export const canSuperviseAtDudi = anyRole('pembimbing_industri');
