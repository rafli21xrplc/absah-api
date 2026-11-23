import { STAFF_ROLES } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** Records and reads UKS visits (KSW-08): the notes are medical, so only the petugas UKS sees them. */
export const canUseUks = anyRole('petugas_uks');

/** Appoints the TPPK team (KSW-06). Being admin gives no access to reports: only membership does. */
export const canAppointTppk = anyRole('admin');

/** Who is on the team is announced to the school, so any staff member may see it. */
export const canSeeTppkTeam = anyRole(...STAFF_ROLES);

/** Point rules (KSW-01): the discipline team sets them, teachers read them to record entries (KSW-02). */
export const canManagePointRules = anyRole('admin', 'wakasek');
export const canReadPointRules = anyRole('admin', 'kepsek', 'wakasek', 'wali_kelas', 'guru');

/** Point entries (KSW-02): any teacher records; leaders read a student's profile; wali kelas only their own class. */
export const canRecordPoints = anyRole('admin', 'wakasek', 'wali_kelas', 'guru');
export const canReversePoints = anyRole('admin', 'wakasek');
export const canSeeAllPoints = anyRole('admin', 'kepsek', 'wakasek');
export const canReadStudentPoints = anyRole('admin', 'kepsek', 'wakasek', 'wali_kelas');

/** Thresholds and follow-up tasks (KSW-03): the discipline team sets tiers; tasks go to the wali kelas, BK and leaders. */
export const canManageThresholds = anyRole('admin', 'wakasek');
export const canReadThresholds = anyRole('admin', 'kepsek', 'wakasek', 'wali_kelas', 'guru_bk');
export const canSeeAllFollowups = anyRole('admin', 'kepsek', 'wakasek', 'guru_bk');
export const canReadFollowups = anyRole('admin', 'kepsek', 'wakasek', 'wali_kelas', 'guru_bk');
/** The kepsek reads tasks but does not close them. */
export const canFollowUp = anyRole('admin', 'wakasek', 'wali_kelas', 'guru_bk');

/** Early warnings (KSW-04): the wali kelas of the class, guru BK and the leaders read them. */
export const canReadEarlyWarnings = anyRole('admin', 'kepsek', 'wakasek', 'wali_kelas', 'guru_bk');
