import { BILLING_MANAGERS, BILLING_READERS } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** TGH-01: fee types, issuing and voiding bills are the bendahara's (and admin's) work. */
export const canManageBilling = anyRole(...BILLING_MANAGERS);
/** Reading the bills and the recap: those, with kepsek and wakasek. */
export const canReadStudentBills = anyRole(...BILLING_READERS);
