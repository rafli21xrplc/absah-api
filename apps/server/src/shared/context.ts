import type { CapabilityValues, Level } from '@absah/capabilities';
import type { Role } from '@absah/contracts';
import type { Request } from 'express';
import { UnauthenticatedError, ValidationError } from './errors';
import type { Actor } from './policy';

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  twoFactorEnabled: boolean;
}

export interface MembershipSummary {
  schoolId: string;
  schoolName: string;
  level: Level;
  isMadrasah: boolean;
  timezone: string;
  roles: Role[];
}

/** Filled by resolveContext. caps is empty when no school is selected. */
export interface RequestContext {
  user: AuthUser;
  userId: string;
  memberships: MembershipSummary[];
  schoolId: string | null;
  roles: Role[];
  caps: Partial<CapabilityValues>;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

export function getCtx(req: Request): RequestContext {
  if (!req.ctx) throw new UnauthenticatedError();
  return req.ctx;
}

/** The actor for school-scoped use cases; rejects requests without X-School-Id. */
export function getActor(req: Request): Actor {
  const ctx = getCtx(req);
  if (!ctx.schoolId) throw new ValidationError({ header: 'X-School-Id' }, 'Header X-School-Id wajib diisi.');
  return { userId: ctx.userId, schoolId: ctx.schoolId, roles: ctx.roles };
}
