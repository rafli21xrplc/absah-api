import { BILLING_MANAGERS, BILLING_READERS, STUDENT_BILL_PAYERS } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** TGH-01: fee types, issuing and voiding bills are the bendahara's (and admin's) work. */
export const canManageBilling = anyRole(...BILLING_MANAGERS);
/** Reading the bills and the recap: those, with kepsek and wakasek. */
export const canReadStudentBills = anyRole(...BILLING_READERS);

/** TGH-03: a parent or the student sees and pays the bills of their own children, and nobody else's. */
export const canPayStudentBills = anyRole(...STUDENT_BILL_PAYERS);
