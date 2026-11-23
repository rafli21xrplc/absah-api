// Ops CLI: pnpm --filter @absah/server attendance:generate --school <id> [--date YYYY-MM-DD] [--force] [--json]
// Generates a school's attendance sessions now instead of waiting for prs.generate-sessions at 05.00,
// e.g. after the timetable changed during the day (existing sessions are kept). --force also runs
// on holidays and non-school days, and again for a date already generated. Uses DATABASE_URL.
import { parseArgs } from 'node:util';
import { findSchool, generateForSchool } from '../modules/attendance';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb, withPlatform } from '../shared/db';
import { schoolDate } from '../shared/school-date';

const { values } = parseArgs({
  options: {
    school: { type: 'string' },
    date: { type: 'string' },
    force: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});
if (!values.school || (values.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.date))) {
  process.stderr.write('usage: attendance:generate --school <id> [--date YYYY-MM-DD] [--force] [--json]\n');
  process.exit(2);
}

const config = loadConfig();
initCrypto(config);
initDb(config);
try {
  const school = await withPlatform((tx) => findSchool(tx, values.school ?? ''));
  if (!school) {
    process.stderr.write('school not found\n');
    process.exitCode = 1;
  } else {
    const date = values.date ?? schoolDate(school.timezone);
    const result = (await generateForSchool(school, date, new Date(), { force: values.force })) ?? { schoolDate: date, created: 0, note: 'already generated or no active academic year' };
    process.stdout.write(values.json ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result, null, 2)}\n`);
  }
} finally {
  await closeDb();
}
