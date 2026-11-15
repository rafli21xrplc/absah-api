import { loadLocalEnv } from '../src/env';
import { runMigrations } from '../src/migrate';

/** Integration tests need a real Postgres. They fail loudly instead of skipping. */
export default async function setup(): Promise<void> {
  loadLocalEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start Postgres (16+; Neon runs 18) (docker compose up -d, or a local install) ' +
        'and set TEST_DATABASE_URL in .env.local. Never point it at a shared or production database.',
    );
  }
  await runMigrations(url);
}
