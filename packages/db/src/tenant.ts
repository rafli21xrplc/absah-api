import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

export interface TenantContext {
  schoolId: string;
  /** Null for system work (jobs) that acts on behalf of no user. */
  userId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z_][a-z0-9_]*$/;

/** Database role without BYPASSRLS that every tenant transaction switches to. */
export const DEFAULT_APP_ROLE = 'absah_app';

/**
 * Runs fn in a transaction scoped to one school. The settings are transaction-local
 * (set_config(..., true)), so this is safe on Neon's pooler in transaction mode.
 *
 * The transaction also switches to the app role, so RLS applies even when the login
 * role owns the tables or is a superuser (local dev, CI).
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options: { appRole?: string } = {},
): Promise<T> {
  const appRole = options.appRole ?? DEFAULT_APP_ROLE;
  if (!UUID_RE.test(ctx.schoolId)) throw new Error('withTenant: schoolId must be a UUID');
  if (ctx.userId !== null && !UUID_RE.test(ctx.userId)) throw new Error('withTenant: userId must be a UUID or null');
  if (!ROLE_RE.test(appRole)) throw new Error('withTenant: invalid app role name');

  return scoped(db, appRole, ctx.schoolId, ctx.userId ?? '', fn);
}

/**
 * Runs fn scoped to one user across schools (no active school). Only for lookups that must span
 * schools before a school is chosen, e.g. listing a user's memberships for /me/context. RLS lets
 * it read the user's own memberships and the schools they belong to, nothing else.
 */
export async function withUser<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  options: { appRole?: string } = {},
): Promise<T> {
  const appRole = options.appRole ?? DEFAULT_APP_ROLE;
  if (!UUID_RE.test(userId)) throw new Error('withUser: userId must be a UUID');
  if (!ROLE_RE.test(appRole)) throw new Error('withUser: invalid app role name');
  return scoped(db, appRole, '', userId, fn);
}

function scoped<T>(db: Db, appRole: string, schoolId: string, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('role', ${appRole}, true),
      set_config('app.school_id', ${schoolId}, true),
      set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
