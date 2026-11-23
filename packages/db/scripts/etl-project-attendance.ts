// ETL from the old project-attendance app (prompt 4.4). Dry-run by default:
//   pnpm --filter @absah/db etl:project-attendance --dump <file.sql> --school <id> --out <dir> [--apply]
// Reads a local mysqldump (never downloads anything), maps it, writes <out>/gagal.csv (rows that could
// not be mapped), <out>/undang-ulang.csv (teachers to invite again: old passwords are not copied) and
// <out>/siswa.csv (students that would be created). --apply then writes rombel, students and
// enrollments into the school's active year. The CSVs hold personal data: keep them off shared
// drives and delete them after go-live. Uses DATABASE_URL (or DATABASE_URL_DIRECT).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { applyEtl, EtlError, existingNisns } from '../etl/apply';
import { toCsv } from '../etl/csv';
import { readDump } from '../etl/mysql-dump';
import { LEGACY_TABLES, mapProjectAttendance } from '../etl/project-attendance';
import { createDb } from '../src/client';
import { loadLocalEnv, requireEnv } from '../src/env';
import { withTenant } from '../src/tenant';
import * as schema from '../src/schema';
import { eq } from 'drizzle-orm';

const { values } = parseArgs({ options: { dump: { type: 'string' }, school: { type: 'string' }, out: { type: 'string' }, apply: { type: 'boolean', default: false } } });
if (!values.dump || !values.school || !values.out) {
  process.stderr.write('usage: etl:project-attendance --dump <file.sql> --school <id> --out <dir> [--apply]\n');
  process.exit(2);
}

loadLocalEnv();
const handle = createDb(process.env.DATABASE_URL_DIRECT ?? requireEnv('DATABASE_URL'), { max: 1 });
const appRole = process.env.DB_APP_ROLE;
const options = appRole ? { appRole } : {};
try {
  const schoolId = values.school;
  const [year] = await withTenant(handle.db, { schoolId, userId: null }, (tx) => tx.select().from(schema.academicYears).where(eq(schema.academicYears.isActive, true)), options);
  if (!year) throw new EtlError('Sekolah belum punya tahun ajaran aktif. Buat dulu lewat impor Dapodik atau pengaturan, lalu ulangi.');

  const tables = readDump(readFileSync(values.dump, 'utf8'), LEGACY_TABLES);
  const plan = mapProjectAttendance(tables, { yearStartsOn: year.startsOn, existingNisns: await existingNisns(handle.db, schoolId, options) });

  mkdirSync(values.out, { recursive: true });
  writeFileSync(path.join(values.out, 'gagal.csv'), toCsv(['tabel', 'id_lama', 'alasan', 'keterangan'], plan.failures.map((f) => [f.table, f.legacyId, f.reason, f.detail])));
  writeFileSync(path.join(values.out, 'undang-ulang.csv'), toCsv(['nama', 'nip', 'nomor_whatsapp', 'wali_kelas'], plan.teachers.map((t) => [t.name, t.nip, t.phone, t.homeroomOf.join('; ')])));
  writeFileSync(path.join(values.out, 'siswa.csv'), toCsv(['nisn', 'nama', 'rombel', 'mulai'], plan.students.map((s) => [s.nisn, s.name, s.className, s.startsOn])));

  const summary = {
    mode: values.apply ? 'apply' : 'dry-run',
    academicYear: year.name,
    classes: plan.classes.length,
    students: plan.students.length,
    teachersToInvite: plan.teachers.length,
    failures: plan.failures.length,
    skipped: plan.skipped,
    ...(values.apply ? await applyEtl(handle.db, schoolId, plan, options) : {}),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (err) {
  if (!(err instanceof EtlError)) throw err;
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
