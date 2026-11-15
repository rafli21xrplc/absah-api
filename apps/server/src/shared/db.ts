import {
  createDb,
  withPlatform as withPlatformOn,
  withTenant as withTenantOn,
  withUser as withUserOn,
  type DbHandle,
  type TenantContext,
  type Tx,
} from '@absah/db';
import type { Config } from './config';

let handle: DbHandle | undefined;
let appRole = 'absah_app';

/** Opens the pooled connection once per process. */
export function initDb(config: Config): DbHandle {
  handle ??= createDb(config.DATABASE_URL);
  appRole = config.DB_APP_ROLE;
  return handle;
}

export function getDb(): DbHandle {
  if (!handle) throw new Error('Database not initialised; call initDb(config) at startup');
  return handle;
}

/** The only way request and job code should touch tenant data (CLAUDE.md rule 1). */
export function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenantOn(getDb().db, ctx, fn, { appRole });
}

/** Cross-school lookups for one user before a school is chosen (/me/context only). */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserOn(getDb().db, userId, fn, { appRole });
}

/**
 * Login role, no RLS scoping. Only for platform tables and cross-school maintenance jobs
 * (expiry, outbox relay, webhook inbox). Never for request handling. See CLAUDE.md.
 */
export function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withPlatformOn(getDb().db, fn);
}

export async function closeDb(): Promise<void> {
  await handle?.close();
  handle = undefined;
}
