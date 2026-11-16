import { anyRole } from '../../../shared/policy';

/** Pairs, lists and revokes kiosk devices (GRB-02). */
export const canManageKiosks = anyRole('admin', 'operator');
