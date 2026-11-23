import { anyRole } from '../../../shared/policy';

/** Manages DUDI partners and placements (PKL-01): humas PKL, wakasek, admin. */
export const canManagePkl = anyRole('admin', 'wakasek', 'humas_pkl');

/** Sees every placement and check-in; anyone else only those they supervise. */
export const canSeeAllPkl = anyRole('admin', 'wakasek', 'humas_pkl', 'kepsek');

/** Checks in at the DUDI from the PWA (PKL-02): the student's own login. */
export const canCheckIn = anyRole('siswa');

/** Confirms and disputes check-ins of the students at their place (PKL-02); rows filter by industry_mentor_id. */
export const canSuperviseAtDudi = anyRole('pembimbing_industri');

/**
 * Reads the DUDI assessment aspects and results (PKL-04): the PKL managers, kepsek, the industry supervisors and teachers (a guru
 * pembimbing is any teacher named school mentor of a placement; the rows they get are filtered to those placements).
 */
export const canReadPklAssessment = anyRole('admin', 'wakasek', 'humas_pkl', 'kepsek', 'pembimbing_pkl', 'pembimbing_industri', 'guru');

/** Exports the assessment results (PKL-04): everyone who reads them except the industry supervisors, who only see their own students. */
export const canExportPklAssessment = anyRole('admin', 'wakasek', 'humas_pkl', 'kepsek', 'pembimbing_pkl', 'guru');

/** Keeps the alumni list and enters tracer answers (PKL-05). The BKK has no role of its own: humas PKL, wakasek and admin do it. */
export const canManageTracer = canManagePkl;

/** Reads the alumni list and the BMW recap: the managers and kepsek. */
export const canReadTracer = canSeeAllPkl;
