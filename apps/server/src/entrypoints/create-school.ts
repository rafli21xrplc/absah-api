// Ops CLI: pnpm --filter @absah/server school:create --name "SD Negeri 1 Uji" --admin-name "Bu Ani" \
//   --admin-email ani@sekolah.sch.id [--level sd]
// Prints the admin's invitation link (valid 7 days). Uses DATABASE_URL from the environment.
import { isLevel } from '@absah/capabilities';
import { parseArgs } from 'node:util';
import { createAuth, createSchoolWithAdmin } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';
import { FakeMessageSender } from '../shared/messaging/message-sender';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    level: { type: 'string' },
    'admin-name': { type: 'string' },
    'admin-email': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});
const { name, level, json } = values;
const adminName = values['admin-name'];
const adminEmail = values['admin-email'];
if (!name || !adminName || !adminEmail || (level !== undefined && !isLevel(level))) {
  process.stderr.write('usage: school:create --name <school> --admin-name <name> --admin-email <email> [--level sd|smp|sma|smk] [--json]\n');
  process.exit(2);
}

const config = loadConfig();
initCrypto(config);
const { db } = initDb(config);
// No OTP is sent from this script; the sender is only required by createAuth.
const auth = createAuth({ db, config, messageSender: new FakeMessageSender() });
try {
  const result = await createSchoolWithAdmin(
    auth,
    { schoolName: name, level: level !== undefined && isLevel(level) ? level : undefined, adminName, adminEmail },
    config.BETTER_AUTH_URL,
  );
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : `school ${result.schoolId}\ninvite ${result.inviteUrl}\n`);
} finally {
  await closeDb();
}
