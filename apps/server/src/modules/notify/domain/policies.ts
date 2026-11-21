import { STAFF_ROLES } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** Sees the delivery dashboard (masked numbers, failures). */
export const canSeeNotifications = anyRole('admin', 'operator');

/** Sets their own message preferences (ORT-06): only a parent, for their own number. */
export const canSetPreferences = anyRole('orang_tua');

/** Gets Web Push (NTF-06): school staff. An industry supervisor is not school staff and uses WhatsApp. */
export const canUsePush = anyRole(...STAFF_ROLES.filter((r) => r !== 'pembimbing_industri'));
