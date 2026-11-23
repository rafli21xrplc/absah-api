// Public API of the platform module. Other modules import only from here.
export { healthRouter } from './http/health';
export { platformRouter } from './http/me';
export { resolveContext, type ResolveContextOptions } from './http/context';
export { createAuth, PHONE_E164_ID, type Auth, type AuthDeps } from './infrastructure/auth';
export { createPhoneUser, createStaffUser } from './infrastructure/users';
export { lastPhoneOtp } from './application/dev-otp';
export { seedPilot, type PilotSeedResult } from './application/pilot';
export { inviteMember } from './application/invitations';
export { createSchoolWithAdmin } from './application/create-school';
export { setReleaseFlag } from './application/release-flags';
export { HEARTBEAT_QUEUE, heartbeatHandler } from './jobs/heartbeat';
export {
  IDEMPOTENCY_CLEANUP_QUEUE,
  deleteExpiredIdempotencyKeys,
  idempotencyCleanupHandler,
} from './jobs/idempotency-cleanup';
export { ensurePhoneLogin, hasActiveMembership, loginPhoneOf, setPortalMembership, sharedPhoneLogin, type PhoneRole } from './application/portal-access';
