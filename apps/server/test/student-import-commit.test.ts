import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeStaleImports } from '../src/modules/academic';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { fixture, importer, type Preview } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let operatorId: string;

beforeAll(async () => {
  const o = await t.staff('Operator Commit');
  operatorId = o.id;
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
});

async function newSchool() {
  const school = await t.school('smp', 'SMP Commit');
  await t.member(school, operatorId, 'operator');
  return { school, imports: importer(t, operator, school) };
}

/** The school's registry as the app role sees it (RLS applies). */
const registry = (school: string) =>
  withTenant({ schoolId: school, userId: null }, async (tx) => ({
    years: await tx.select().from(schema.academicYears),
    semesters: await tx.select().from(schema.semesters),
    classes: await tx.select().from(schema.classes),
    students: await tx.select().from(schema.students),
    enrollments: await tx.select().from(schema.enrollments),
    links: await tx.select().from(schema.studentGuardians),
  }));

async function commitReady(imports: ReturnType<typeof importer>, file: Buffer) {
  const ready = await imports.prepare(file);
  expect(ready.status).toBe('ready');
  const res = await imports.commit(ready.id).expect(200);
  return { ready, committed: res.body as Preview };
}

describe('POST /imports/{id}/commit', () => {
  it('creates the year, rombel, students, enrollments and guardians in one go', async () => {
    const { school, imports } = await newSchool();
    const { committed } = await commitReady(imports, await fixture('daftar-pd-awal.xlsx'));
    expect(committed.status).toBe('committed');

    const r = await registry(school);
    expect(r.years).toHaveLength(1);
    expect(r.years[0]).toMatchObject({ isActive: true, name: committed.academicYear });
    expect(r.semesters).toHaveLength(2);
    expect(r.classes.map((c) => [c.name, c.grade]).sort()).toEqual([
      ['VII A', 7],
      ['VII B', 7],
      ['VIII A', 8],
    ]);
    expect(r.students).toHaveLength(10);
    expect(r.enrollments.filter((e) => e.status === 'active')).toHaveLength(10);
    const fajar = r.students.find((s) => s.name === 'FAJAR NUGROHO');
    expect(fajar?.nik?.reveal()).toBe('9901010112120006');
    expect(r.links.filter((l) => l.studentId === fajar?.id).map((l) => [l.relation, l.isPrimary]).sort()).toEqual([
      ['ayah', false],
      ['ibu', true],
      ['wali', false],
    ]);
  });

  it('importing the same file again creates no duplicates', async () => {
    const { school, imports } = await newSchool();
    const file = await fixture('daftar-pd-awal.xlsx');
    await commitReady(imports, file);
    const before = await registry(school);

    const { ready } = await commitReady(imports, file);
    expect(ready.counts).toMatchObject({ created: 0, changed: 0, unchanged: 10, missing: 0, rejected: 0 });
    const after = await registry(school);
    expect(after.students).toHaveLength(10);
    expect(after.enrollments).toHaveLength(before.enrollments.length);
    expect(after.links).toHaveLength(before.links.length);
    expect(after.classes).toHaveLength(3);
  });

  it('applies changes and flags students missing from the file as calon keluar, never deleting them', async () => {
    const { school, imports } = await newSchool();
    await commitReady(imports, await fixture('daftar-pd-awal.xlsx'));
    const { ready } = await commitReady(imports, await fixture('daftar-pd-perubahan.xlsx'));

    expect(ready.counts).toMatchObject({ created: 1, changed: 3, unchanged: 6, missing: 1, rejected: 0 });
    const changed = Object.fromEntries(ready.items.filter((i) => i.kind === 'changed').map((i) => [i.name, i.changes.map((c) => c.field)]));
    expect(changed).toEqual({
      'DIMAS ANGGARA': ['className'],
      'EKA PUTRI RAHAYU NINGSIH': ['name'],
      'GITA SAFITRI': ['nisn'],
    });
    expect(ready.items.find((i) => i.kind === 'missing')).toMatchObject({ name: 'BUNGA LESTARI', className: 'VII A' });

    const r = await registry(school);
    expect(r.students).toHaveLength(11); // nobody deleted
    const id = (name: string) => r.students.find((s) => s.name === name)?.id;
    const enrollmentsOf = (name: string) => r.enrollments.filter((e) => e.studentId === id(name));
    const className = (classId: string) => r.classes.find((c) => c.id === classId)?.name;

    const bunga = enrollmentsOf('BUNGA LESTARI');
    expect(bunga).toHaveLength(1);
    expect(bunga[0]?.status).toBe('active');
    expect(bunga[0]?.missingSince).not.toBeNull();

    const dimas = enrollmentsOf('DIMAS ANGGARA');
    expect(dimas.filter((e) => e.status === 'active').map((e) => className(e.classId))).toEqual(['VII B']);
    expect(r.students.find((s) => s.name === 'GITA SAFITRI')?.nisn).toBe('0131000007');
    expect(id('EKA PUTRI RAHAYU NINGSIH')).toBeDefined();
    expect(enrollmentsOf('KARINA OKTAVIA').map((e) => className(e.classId))).toEqual(['VII A']);

    // Back in a later file: no longer calon keluar.
    await commitReady(imports, await fixture('daftar-pd-awal.xlsx'));
    const again = await registry(school);
    expect(again.enrollments.find((e) => e.studentId === id('BUNGA LESTARI') && e.status === 'active')?.missingSince).toBeNull();
  });

  it('refuses a stale preview without writing anything, and is idempotent once committed', async () => {
    const { school, imports } = await newSchool();
    const first = await imports.prepare(await fixture('daftar-pd-awal.xlsx'));
    const second = await imports.prepare(await fixture('daftar-pd-awal.xlsx'));
    const done = await imports.commit(first.id, 'same-key-commit').expect(200);
    await imports.commit(first.id, 'same-key-commit').expect(200); // replay
    await imports.commit(first.id).expect(200); // new key, already committed: same result
    expect((done.body as Preview).status).toBe('committed');

    const stale = await imports.commit(second.id).expect(409);
    expect((stale.body as { details: { reason: string } }).details.reason).toBe('stale_preview');
    expect((await registry(school)).students).toHaveLength(10);

    // Refresh the preview, then it applies (nothing to change).
    await imports.requestParse(second.id);
    await imports.runParseJob(second.id);
    expect((await imports.preview(second.id)).counts).toMatchObject({ created: 0, unchanged: 10 });
    await imports.commit(second.id).expect(200);
  });

  it('drops the NIKs from the stored preview and the file from storage once committed', async () => {
    const { school, imports } = await newSchool();
    const { ready } = await commitReady(imports, await fixture('daftar-pd-awal.xlsx'));
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) =>
      tx.select().from(schema.studentImports).where(eq(schema.studentImports.id, ready.id)),
    );
    expect(row?.preview?.reveal()).not.toContain('9901010211130001');
    expect(row ? await t.storage.read(row.fileKey) : 'missing').toBeNull();
  });

  it('expires imports never applied within 7 days: file and NIKs gone', async () => {
    const { school, imports } = await newSchool();
    const ready = await imports.prepare(await fixture('daftar-pd-awal.xlsx'));
    const [row] = await getDb().db.select().from(schema.studentImports).where(eq(schema.studentImports.id, ready.id));
    expect(row && (await t.storage.read(row.fileKey))).not.toBeNull();

    await purgeStaleImports(t.storage, new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    const expired = await imports.preview(ready.id);
    expect(expired).toMatchObject({ status: 'failed', items: [] });
    expect(expired.error).toContain('Kedaluwarsa');
    expect(row ? await t.storage.read(row.fileKey) : 'missing').toBeNull();
    await imports.commit(ready.id).expect(409);
    expect((await registry(school)).students).toEqual([]);
  });
});
