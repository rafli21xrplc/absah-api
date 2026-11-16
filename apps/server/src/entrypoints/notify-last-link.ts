// Dev/e2e CLI: pnpm --filter @absah/server notify:last-link --school <id>
// Prints the action link of the school's newest WhatsApp message as JSON ({ templateCode, link }
// or null). The token is a credential: refuses NODE_ENV=production.
import { parseArgs } from 'node:util';
import { lastActionLink } from '../modules/notify';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';

const { values } = parseArgs({ options: { school: { type: 'string' } } });
if (!values.school) {
  process.stderr.write('usage: notify:last-link --school <id>\n');
  process.exit(2);
}
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('notify:last-link prints a credential and is not for production\n');
  process.exit(2);
}

const config = loadConfig();
initCrypto(config);
initDb(config);
try {
  process.stdout.write(`${JSON.stringify(await lastActionLink(values.school))}\n`);
} finally {
  await closeDb();
}
