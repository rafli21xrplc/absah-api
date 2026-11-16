// Dev/staging CLI: pnpm --filter @absah/server gate:load-fixture --school <id> > fixture.json
// Creates a kiosk and test phones for every active student without a card, then prints what
// load/kiosk-scans.k6.js needs (kiosk token + today's device keys). Refuses NODE_ENV=production.
import { parseArgs } from 'node:util';
import { createLoadFixture } from '../modules/gate';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';

const { values } = parseArgs({ options: { school: { type: 'string' } } });
if (!values.school) {
  process.stderr.write('usage: gate:load-fixture --school <id>\n');
  process.exit(2);
}
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('gate:load-fixture creates test phones and is not for production\n');
  process.exit(2);
}

const config = loadConfig();
initCrypto(config);
initDb(config);
try {
  process.stdout.write(`${JSON.stringify(await createLoadFixture(values.school))}\n`);
} finally {
  await closeDb();
}
