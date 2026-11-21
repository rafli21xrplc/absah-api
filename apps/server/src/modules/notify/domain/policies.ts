import { anyRole } from '../../../shared/policy';

/** Sees the delivery dashboard (masked numbers, failures). */
export const canSeeNotifications = anyRole('admin', 'operator');

/** Sets their own message preferences (ORT-06): only a parent, for their own number. */
export const canSetPreferences = anyRole('orang_tua');
