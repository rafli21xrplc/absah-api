// Fails (exit 1) when a tenant table lacks RLS or a policy, or when the app role can bypass RLS.
import pg from 'pg';
import { loadLocalEnv, requireEnv } from '../src/env';
import { findRlsViolations } from '../src/rls';
import { DEFAULT_APP_ROLE } from '../src/tenant';

loadLocalEnv();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT ?? requireEnv('DATABASE_URL') });
await client.connect();
try {
  const violations = await findRlsViolations(client, process.env.DB_APP_ROLE ?? DEFAULT_APP_ROLE);
  if (violations.length > 0) {
    for (const v of violations) console.error(`RLS violation: ${v.table} -> ${v.problem}`);
    process.exitCode = 1;
  } else {
    console.log('db:check-rls OK');
  }
} finally {
  await client.end();
}
