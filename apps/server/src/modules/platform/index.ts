// Public API of the platform module. Other modules import only from here.
export { healthRouter } from './http/health';
export { platformRouter } from './http/me';
export { resolveContext, type ResolveContextOptions } from './http/context';
export { createAuth, PHONE_E164_ID, type Auth, type AuthDeps } from './infrastructure/auth';
export { createPhoneUser, createStaffUser } from './infrastructure/users';
export { inviteMember } from './application/invitations';
export { createSchoolWithAdmin } from './application/create-school';
export { HEARTBEAT_QUEUE, heartbeatHandler } from './jobs/heartbeat';
export {
  IDEMPOTENCY_CLEANUP_QUEUE,
  deleteExpiredIdempotencyKeys,
  idempotencyCleanupHandler,
} from './jobs/idempotency-cleanup';
export { ensurePhoneLogin, hasActiveMembership, loginPhoneOf, setPortalMembership } from './application/portal-access';
