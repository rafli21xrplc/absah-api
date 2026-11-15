import { ForbiddenError } from './errors';
import type { Actor, Policy } from './policy';

/** Called at the start of every use case (not only in routers), so jobs and routes share the rule. */
export function authorize(actor: Actor, policy: Policy): void {
  if (!policy.allows(actor)) throw new ForbiddenError();
}
