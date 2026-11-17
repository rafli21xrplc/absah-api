import { anyRole } from '../../../shared/policy';

/** Pairs, lists and revokes kiosk devices (GRB-02). */
export const canManageKiosks = anyRole('admin', 'operator');

/** Enters arrivals by hand at the gate (GRB-05). */
export const canRecordArrivals = anyRole('piket', 'admin', 'operator', 'wakasek');
/** Sees who is late or not in yet (GRB-06). */
export const canSeeGateToday = anyRole('piket', 'admin', 'operator', 'wakasek', 'kepsek');

/** Lists the day's guests and signs them out (GRB-11). */
export const canManageVisitors = anyRole('piket', 'admin', 'operator', 'wakasek');
export const canSeeVisitors = anyRole('piket', 'admin', 'operator', 'wakasek', 'kepsek');

/** Penjemput resmi (GRB-09): the admin decides for every student, the wali kelas for their rombel. */
export const canDecidePickupGuardians = anyRole('admin');
/** Sees penjemput photos besides the student's wali kelas (the kiosk sees them at check-out). */
export const canSeePickupPhotos = anyRole('admin', 'piket');
