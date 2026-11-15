import { createDb, loadLocalEnv, runMigrations } from '@absah/db';
import { sql } from 'drizzle-orm';

/** Server integration tests need Postgres (TEST_DATABASE_URL); they fail rather than skip. */
export default async function setup(): Promise<void> {
  loadLocalEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example).');
  await runMigrations(url);
  const h = createDb(url, { max: 1 });
  try {
    await h.db.execute(sql`delete from rate_limit`); // counters from earlier runs
  } finally {
    await h.close();
  }
}
