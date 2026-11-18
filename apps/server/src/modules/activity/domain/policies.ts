import { anyRole } from '../../../shared/policy';

/** Creates activities and appoints coaches (KEG-01). */
export const canManageActivities = anyRole('admin', 'wakasek');

/** Sees every activity of the school; anyone else sees the ones they coach. */
export const canSeeAllActivities = anyRole('admin', 'operator', 'wakasek', 'kepsek');

/** Records setoran hafalan (KEG-03): the guru tahfidz, and the admin for corrections. */
export const canRecordMemorization = anyRole('guru_tahfidz', 'admin');
