import { anyRole } from '../../../shared/policy';

/** Sees the delivery dashboard (masked numbers, failures). */
export const canSeeNotifications = anyRole('admin', 'operator');
