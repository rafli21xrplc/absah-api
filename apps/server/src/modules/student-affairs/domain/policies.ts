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
