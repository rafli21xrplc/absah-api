// Ops CLI: pnpm --filter @absah/server billing:issue --school <id> --month YYYY-MM
// Issues one school's invoice for a month now instead of waiting for bil.issue-invoices (e.g. after a
// failed run, or in e2e). Idempotent: a month already issued is left unchanged. Uses DATABASE_URL.
import { parseArgs } from 'node:util';
import { issueInvoiceForSchool } from '../modules/subscription';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';

const { values } = parseArgs({ options: { school: { type: 'string' }, month: { type: 'string' } } });
if (!values.school || !values.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)) {
  process.stderr.write('usage: billing:issue --school <id> --month YYYY-MM\n');
  process.exit(2);
}

const config = loadConfig();
initCrypto(config);
initDb(config);
try {
  const result = await issueInvoiceForSchool(values.school, values.month, new Date());
  process.stdout.write(`${JSON.stringify(result ?? { note: 'already issued or nothing to bill' })}\n`);
} finally {
  await closeDb();
}
