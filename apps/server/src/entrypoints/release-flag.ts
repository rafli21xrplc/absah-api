// Ops CLI (Absah team only): pnpm --filter @absah/server release:flag --flag rdm-export-beta
// (--school <id> | --all) [--off] [--reason "..."]
// Opens (or closes) a feature still in trial for one school or for every school (platform_flags,
// owner role from DATABASE_URL). A school row beats the global row.
import { RELEASE_FLAGS } from '@absah/capabilities';
import { parseArgs } from 'node:util';
import { setReleaseFlag } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { closeDb, initDb } from '../shared/db';

const { values } = parseArgs({
  options: {
    flag: { type: 'string' },
    school: { type: 'string' },
    all: { type: 'boolean', default: false },
    off: { type: 'boolean', default: false },
    reason: { type: 'string', default: 'uji coba bersama sekolah mitra' },
  },
});
if (!values.flag || values.all === Boolean(values.school)) {
  process.stderr.write(`usage: release:flag --flag <${RELEASE_FLAGS.join('|')}> (--school <id> | --all) [--off] [--reason "..."]\n`);
  process.exit(2);
}

initDb(loadConfig());
try {
  const flag = await setReleaseFlag(values.flag, values.school ?? null, !values.off, values.reason);
  process.stdout.write(`${flag} ${values.off ? 'off' : 'on'} for ${values.school ?? 'every school'}\n`);
} finally {
  await closeDb();
}
