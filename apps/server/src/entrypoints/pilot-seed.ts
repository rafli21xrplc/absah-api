// Dev/staging CLI: PILOT_PASSWORD=... pnpm --filter @absah/server pilot:seed
// Seeds "SMA Absah Uji 1" (36 rombel, 900 synthetic students, teachers, timetable, mapel pilihan) once
// and prints the school id; staff log in as <key>@pilot.absah.test (admin, kepsek, wakasek, operator,
// guru001...) with PILOT_PASSWORD. Guardian numbers are synthetic, so it refuses any real WhatsApp
// sender (and therefore production).
import { createAuth, seedPilot } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';
import { FakeMessageSender } from '../shared/messaging/message-sender';

const config = loadConfig();
if (config.WHATSAPP_PROVIDER !== 'fake') {
  process.stderr.write('pilot:seed writes synthetic phone numbers and needs WHATSAPP_PROVIDER=fake\n');
  process.exit(2);
}
const password = process.env.PILOT_PASSWORD ?? '';
if (password.length < 12) {
  process.stderr.write('set PILOT_PASSWORD (at least 12 characters) for the staff accounts\n');
  process.exit(2);
}

initCrypto(config);
const { db } = initDb(config);
const auth = createAuth({ db, config, messageSender: new FakeMessageSender() });
const started = Date.now();
try {
  const result = await seedPilot(auth, { password, hashKey: config.HASH_KEY, appRole: config.DB_APP_ROLE });
  process.stdout.write(`${JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 1000) })}\n`);
} finally {
  await closeDb();
}
