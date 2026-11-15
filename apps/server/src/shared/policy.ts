// Pure authorization primitives. domain/ code may import this file (dependency-cruiser allows it).
import type { Role } from '@absah/contracts';

export interface Actor {
  userId: string;
  schoolId: string;
  roles: readonly Role[];
}

export interface Policy {
  /** Shown in logs and tests, never to users. */
  name: string;
  allows: (actor: Actor) => boolean;
}

export function anyRole(...roles: Role[]): Policy {
  return {
    name: `anyRole(${roles.join(',')})`,
    allows: (actor) => actor.roles.some((r) => roles.includes(r)),
  };
}
