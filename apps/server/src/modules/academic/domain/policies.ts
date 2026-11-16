import { anyRole } from '../../../shared/policy';

/** School profile and capability settings (PLT-07, AKD-08). */
export const canManageSchoolSettings = anyRole('admin');
