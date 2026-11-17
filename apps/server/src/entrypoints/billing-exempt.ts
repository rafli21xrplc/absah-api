// Ops CLI (Absah team only): pnpm --filter @absah/server billing:exempt --school <id> --from YYYY-MM-DD
// --to YYYY-MM-DD [--name "Libur akhir tahun ajaran"] [--remove]
// Marks the days of a long year-end break as not billed (they become holidays); --remove unmarks them
// (the holidays stay). Runs as the owner role from DATABASE_URL. Short breaks stay billed.
import { parseArgs } from 'node:util';
import { setBillingExempt } from '../modules/subscription';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';

const { values } = parseArgs({
  options: {
    school: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    name: { type: 'string', default: 'Libur akhir tahun ajaran' },
    remove: { type: 'boolean', default: false },
  },
});
const iso = /^\d{4}-\d{2}-\d{2}$/;
if (!values.school || !values.from || !values.to || !iso.test(values.from) || !iso.test(values.to) || values.from > values.to) {
  process.stderr.write('usage: billing:exempt --school <id> --from YYYY-MM-DD --to YYYY-MM-DD [--name "..."] [--remove]\n');
  process.exit(2);
}

const config = loadConfig();
initCrypto(config);
initDb(config);
try {
  const days = await setBillingExempt(values.school, values.from, values.to, values.name, !values.remove);
  process.stdout.write(`${values.remove ? 'unmarked' : 'marked'} ${days} day(s)\n`);
} finally {
  await closeDb();
}
