// Dev/e2e CLI: pnpm --filter @absah/server auth:last-otp --phone +62812...
// Prints the newest WhatsApp login code for that number as JSON ({ code } or { code: null }); the fake
// sender keeps codes in the http process, so e2e reads Better Auth's own record. The code is a
// credential: refuses NODE_ENV=production.
import { parseArgs } from 'node:util';
import { lastPhoneOtp } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { closeDb, initDb } from '../shared/db';

const { values } = parseArgs({ options: { phone: { type: 'string' } } });
if (!values.phone) {
  process.stderr.write('usage: auth:last-otp --phone <E.164>\n');
  process.exit(2);
}
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('auth:last-otp prints a credential and is not for production\n');
  process.exit(2);
}

initDb(loadConfig());
try {
  process.stdout.write(`${JSON.stringify({ code: await lastPhoneOtp(values.phone) })}\n`);
} finally {
  await closeDb();
}
