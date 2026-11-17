import { anyRole } from '../../../shared/policy';

/** Absah's invoices to the school: the admin pays, the kepala sekolah can read them. */
export const canReadBilling = anyRole('admin', 'kepsek');
export const canPayBilling = anyRole('admin');
