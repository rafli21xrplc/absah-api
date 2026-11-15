import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Arbitrary constant; serialises concurrent migrators (parallel test runs, two deploys). */
const MIGRATION_LOCK_KEY = 727_274_001;

/** Applies pending migrations. Use the direct (non-pooled) URL for DDL. */
export async function runMigrations(connectionString: string): Promise<void> {
  // max: 1 so the advisory lock and the migration share one session.
  const handle = createDb(connectionString, { max: 1 });
  try {
    await handle.pool.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await handle.pool.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await handle.close();
  }
}
