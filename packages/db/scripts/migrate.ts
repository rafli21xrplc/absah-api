// Applies migrations. Uses the direct (non-pooled) URL when available, as Neon recommends for DDL.
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/client';
import { loadLocalEnv, requireEnv } from '../src/env';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb(connectionString, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL_DIRECT ?? requireEnv('DATABASE_URL');
  await runMigrations(url);
  console.log('migrations applied');
}
