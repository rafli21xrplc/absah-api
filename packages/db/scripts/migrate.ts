// Applies migrations. Uses the direct (non-pooled) URL when available, as Neon recommends for DDL.
import { loadLocalEnv, requireEnv } from '../src/env';
import { runMigrations } from '../src/migrate';

loadLocalEnv();
await runMigrations(process.env.DATABASE_URL_DIRECT ?? requireEnv('DATABASE_URL'));
console.log('migrations applied');
