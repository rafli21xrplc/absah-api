import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { fixture, importer } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let operatorId: string;
let guru: Agent;
let guruId: string;
let kepsek: Agent;
let kepsekId: string;
let school: string;

type Student = { id: string; name: string; enrollment: { id: string; className: string; status: string; missingSince: string | null } | null };
type Page = { items: Student[]; nextCursor: string | null };

beforeAll(async () => {
  const o = await t.staff('Operator Registri');
  operatorId = o.id;
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
  const g = await t.staff('Bu Guru Wali');
  guruId = g.id;
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
  const k = await t.staff('Kepala Sekolah');
  kepsekId = k.id;
  kepsek = t.agent();
  await signIn(kepsek, k.email).expect(200);

  school = await t.school('smp', 'SMP Registri');
  await t.member(school, operatorId, 'operator');
  await t.member(school, guruId, 'guru');
  await t.member(school, kepsekId, 'kepsek');
  const imports = importer(t, operator, school);
  for (const file of ['daftar-pd-awal.xlsx', 'daftar-pd-perubahan.xlsx'] as const) {
    const ready = await imports.prepare(await fixture(file));
    await imports.commit(ready.id).expect(200);
  }
});

const students = (agent: Agent, query: Record<string, string> = {}) =>
  agent.get('/api/v1/students').query(query).set('X-School-Id', school);

describe('GET /students', () => {
  it('pages through students by name with a cursor', async () => {
    const first = (await students(kepsek, { limit: '4' }).expect(200)).body as Page;
    expect(first.items.map((s) => s.name)).toEqual(['ADITYA PRATAMA', 'BUNGA LESTARI', 'CANDRA KIRANA', 'DIMAS ANGGARA']);
    const names = first.items.map((s) => s.name);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = (await students(kepsek, { limit: '4', cursor }).expect(200)).body as Page;
      names.push(...page.items.map((s) => s.name));
      cursor = page.nextCursor;
    }
    expect(names).toHaveLength(11);
    expect(new Set(names).size).toBe(11);
    expect(JSON.stringify(first)).not.toMatch(/9901\d{12}/); // no NIK
  });

  it('searches by name or NISN and filters by rombel and calon keluar', async () => {
    const byName = (await students(kepsek, { q: 'dimas' }).expect(200)).body as Page;
    expect(byName.items.map((s) => [s.name, s.enrollment?.className])).toEqual([['DIMAS ANGGARA', 'VII B']]);
    const byNisn = (await students(kepsek, { q: '0121' }).expect(200)).body as Page;
    expect(byNisn.items.map((s) => s.name)).toEqual(['HADI SAPUTRA', 'INDAH PERMATA']);
    const missing = (await students(kepsek, { status: 'missing' }).expect(200)).body as Page;
    expect(missing.items.map((s) => s.name)).toEqual(['BUNGA LESTARI']);
    expect(missing.items[0]?.enrollment?.missingSince).not.toBeNull();

    const classes = (await kepsek.get('/api/v1/classes').set('X-School-Id', school).expect(200)).body as {
      academicYear: { name: string };
      items: { id: string; name: string; activeStudents: number; missingStudents: number }[];
    };
    expect(classes.items.map((c) => [c.name, c.activeStudents, c.missingStudents])).toEqual([
      ['VII A', 4, 1],
      ['VII B', 4, 0],
      ['VIII A', 3, 0],
    ]);
    const viiA = classes.items[0]?.id ?? '';
    const inClass = (await students(kepsek, { classId: viiA }).expect(200)).body as Page;
    expect(inClass.items).toHaveLength(4);
  });

  it('is not for teachers without registry access', async () => {
    await students(guru).expect(403);
    await guru.get('/api/v1/classes').set('X-School-Id', school).expect(403);
  });
});

describe('PATCH /enrollments/{id}', () => {
  const patch = (id: string, body: object) =>
    operator.patch(`/api/v1/enrollments/${id}`).set('X-School-Id', school).set('Idempotency-Key', `enr-${uuidv7()}`).send(body);

  it('settles a calon keluar student as moved, keeping the student and the history', async () => {
    const missing = ((await students(operator, { status: 'missing' }).expect(200)).body as Page).items[0];
    const enrollmentId = missing?.enrollment?.id ?? '';
    await patch(enrollmentId, { status: 'moved', endsOn: '2000-01-01' }).expect(400);
    await kepsek.patch(`/api/v1/enrollments/${enrollmentId}`).set('X-School-Id', school).set('Idempotency-Key', `enr-${uuidv7()}`).send({ status: 'moved' }).expect(403);

    const res = await patch(enrollmentId, { status: 'moved' }).expect(200);
    expect((res.body as Student).enrollment).toBeNull();
    const [row] = await getDb().db.select().from(schema.enrollments).where(eq(schema.enrollments.id, enrollmentId));
    expect(row).toMatchObject({ status: 'moved', missingSince: null });
    expect(row?.endsOn).not.toBeNull();
    await patch(enrollmentId, { status: 'left' }).expect(409);

    const all = (await students(operator, { status: 'all', q: 'bunga' }).expect(200)).body as Page;
    expect(all.items.map((s) => s.name)).toEqual(['BUNGA LESTARI']);
    expect(((await students(operator, { status: 'missing' }).expect(200)).body as Page).items).toEqual([]);
  });
});
