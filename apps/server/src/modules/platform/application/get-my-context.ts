import type { MeContextResponse } from '@absah/contracts';
import type { RequestContext } from '../../../shared/context';

/** GET /me/context. Pure projection of the resolved request context. */
export function getMyContext(ctx: RequestContext): MeContextResponse {
  return {
    user: ctx.user,
    schools: ctx.memberships.map((m) => ({
      id: m.schoolId,
      name: m.schoolName,
      level: m.level,
      isMadrasah: m.isMadrasah,
      timezone: m.timezone,
      roles: m.roles,
    })),
    active: ctx.schoolId ? { schoolId: ctx.schoolId, roles: ctx.roles, capabilities: ctx.caps } : null,
  };
}
