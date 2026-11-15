// Public API of the platform module. Other modules import only from here.
export { healthRouter } from './http/health';
export { platformRouter } from './http/me';
export { resolveContext, type ResolveContextOptions } from './http/context';
export { createAuth, PHONE_E164_ID, type Auth, type AuthDeps } from './infrastructure/auth';
export { createPhoneUser, createStaffUser } from './infrastructure/users';
export { HEARTBEAT_QUEUE, heartbeatHandler } from './jobs/heartbeat';
