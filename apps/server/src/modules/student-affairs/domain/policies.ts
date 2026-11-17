import { anyRole } from '../../../shared/policy';

/** Records and reads UKS visits (KSW-08): the notes are medical, so only the petugas UKS sees them. */
export const canUseUks = anyRole('petugas_uks');
