import { SchoolIdHeader, TWO_FACTOR_REQUIRED_ROLES } from '@absah/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import type { RequestHandler } from 'express';
import { loadCapabilities } from '../../../shared/capability';
import type { RequestContext } from '../../../shared/context';
import { ForbiddenError, TwoFactorRequiredError, UnauthenticatedError, ValidationError } from '../../../shared/errors';
import type { Auth } from '../infrastructure/auth';
import { listActiveMemberships } from '../infrastructure/membership-repo';

export interface ResolveContextOptions {
  /** 'required' rejects requests without X-School-Id; 'optional' is for /me/context. */
  school: 'required' | 'optional';
}

/**
 * Reads the Better Auth session and the X-School-Id header, checks an active membership and
 * fills req.ctx = { userId, schoolId, roles, caps }. Admin/operator must have TOTP enabled.
 */
export function resolveContext(auth: Auth, options: ResolveContextOptions): RequestHandler {
  return async (req, _res, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthenticatedError();

    const { user } = session;
    const memberships = await listActiveMemberships(user.id);

    const header = req.get('x-school-id');
    let schoolId: string | null = null;
    let roles: RequestContext['roles'] = [];
    let caps: RequestContext['caps'] = {};

    if (header !== undefined) {
      const parsed = SchoolIdHeader.safeParse(header);
      if (!parsed.success) throw new ValidationError({ header: 'X-School-Id' }, 'Header X-School-Id tidak valid.');
      const membership = memberships.find((m) => m.schoolId === parsed.data);
      // Same answer for "school does not exist" and "not a member": no probing of school ids.
      if (!membership) throw new ForbiddenError('Anda bukan anggota sekolah ini.');
      schoolId = membership.schoolId;
      roles = membership.roles;
      if (!user.twoFactorEnabled && roles.some((r) => TWO_FACTOR_REQUIRED_ROLES.includes(r))) {
        throw new TwoFactorRequiredError();
      }
      caps = await loadCapabilities({ schoolId, userId: user.id }, membership, req.log);
    } else if (options.school === 'required') {
      throw new ValidationError({ header: 'X-School-Id' }, 'Header X-School-Id wajib diisi.');
    }

    const phoneOnly = user.email.endsWith('@phone.absah.invalid');
    req.ctx = {
      user: {
        id: user.id,
        name: user.name,
        email: phoneOnly ? null : user.email,
        phoneNumber: user.phoneNumber ?? null,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
      },
      userId: user.id,
      memberships,
      schoolId,
      roles,
      caps,
    };
    next();
  };
}
