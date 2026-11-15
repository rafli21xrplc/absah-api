import { createDb, withTenant as withTenantOn, type DbHandle, type TenantContext, type Tx } from '@absah/db';
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

export async function closeDb(): Promise<void> {
  await handle?.close();
  handle = undefined;
}
