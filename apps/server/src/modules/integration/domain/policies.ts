import { anyRole } from '../../../shared/policy';

/** Creates and revokes the school's API keys and webhooks (PLT-09). The admin alone: a key reads the school's data. */
export const canManageIntegrations = anyRole('admin');
