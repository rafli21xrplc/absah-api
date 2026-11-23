import type { AlumniFromClassResult, TracerAlumniList, TracerAlumnus, TracerRecap } from '@absah/contracts';
import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { withTenant } from '../src/shared/db';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let sma: string;
let classId: string;
const agents: Record<string, Agent> = {};
const A = (label: string) => agents[label] as Agent;
const w = (agent: Agent, method: 'post' | 'put', url: string, body: object, s = school) => agent[method](`/api/v1/tracer${url}`).set('X-School-Id', s).set('Idempotency-Key', uuidv7()).send(body);
const get = (agent: Agent, url: string, s = school) => agent.get(`/api/v1/tracer${url}`).set('X-School-Id', s);
const alumni = async (agent: Agent, query = '') => ((await get(agent, `/alumni${query}`).expect(200)).body as TracerAlumniList).items;
const recap = async (agent: Agent) => (await get(agent, '/recap').expect(200)).body as TracerRecap;

beforeAll(async () => {
  [school, sma] = [await t.school('smk', 'SMK Tracer'), await t.school('sma', 'SMA Tanpa Tracer')];
  for (const [label, role] of [['humas', 'humas_pkl'], ['kepsek', 'kepsek'], ['guru', 'guru']] as const) {
    const u = await t.staff(`Tracer ${label}`);
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(A(label), u.email).expect(200);
  }
  classId = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2025/2026', startsOn: '2025-07-01', endsOn: '2026-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: 'XII TKJ 1', grade: 12, stream: 'ipa' }).returning();
    const students = await tx
      .insert(schema.students)
      .values([
        { schoolId: school, name: 'ANDI WIJAYA', nisn: '0012345678' },
        { schoolId: school, name: 'BUNGA LESTARI' },
        { schoolId: school, name: 'CANDRA KUSUMA' },
      ])
      .returning();
    await tx.insert(schema.enrollments).values(students.map((s, i) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2025-07-14', status: i === 2 ? ('left' as const) : ('active' as const) })));
    return cls?.id ?? '';
  });
});

describe('Tracer study (PKL-05)', () => {
  it('starts empty and has no percentage before anybody answered', async () => {
    expect(await alumni(A('humas'))).toEqual([]);
    expect(await recap(A('humas'))).toEqual({ rows: [], totals: { total: 0, answered: 0, counts: { bekerja: 0, melanjutkan: 0, wirausaha: 0, belum: 0 }, bmwPercent: null } });
  });

  it('lists the rombel to copy from, for the BKK only (the registry stays closed to them)', async () => {
    const res = (await get(A('humas'), '/classes').expect(200)).body as { items: { name: string; grade: number; stream: string | null; activeStudents: number }[] };
    expect(res.items).toEqual([expect.objectContaining({ name: 'XII TKJ 1', grade: 12, stream: 'ipa', activeStudents: 2 })]);
    await get(A('kepsek'), '/classes').expect(403);
    await get(A('guru'), '/classes').expect(403);
  });

  it('copies the active students of a rombel (jurusan from the rombel) and skips those already there', async () => {
    const first = (await w(A('humas'), 'post', '/alumni/from-class', { classId, graduationYear: 2026 }).expect(200)).body as AlumniFromClassResult;
    expect(first).toEqual({ added: 2, skipped: 0 });
    expect((await w(A('humas'), 'post', '/alumni/from-class', { classId, graduationYear: 2026 }).expect(200)).body).toEqual({ added: 0, skipped: 2 });
    const rows = await alumni(A('humas'));
    expect(rows.map((r) => [r.name, r.graduationYear, r.stream, r.response])).toEqual([
      ['ANDI WIJAYA', 2026, 'ipa', null],
      ['BUNGA LESTARI', 2026, 'ipa', null],
    ]);
    await w(A('humas'), 'post', '/alumni/from-class', { classId: uuidv7(), graduationYear: 2026 }).expect(404);
  });

  it('adds an alumnus by hand; the phone number comes back masked', async () => {
    const phone = testPhone();
    const res = await w(A('humas'), 'post', '/alumni', { name: 'Dewi Anggraini', nisn: '0098765432', graduationYear: 2025, stream: 'ips', phoneNumber: phone }).expect(201);
    const a = res.body as TracerAlumnus;
    expect(a).toMatchObject({ name: 'Dewi Anggraini', graduationYear: 2025, stream: 'ips', response: null });
    expect(a.phone).toMatch(/\*/);
    expect(a.phone).not.toContain(phone);
    await w(A('humas'), 'post', '/alumni', { name: 'Nomor Salah', graduationYear: 2025, phoneNumber: '081234567890' }).expect(400);
    await w(A('humas'), 'post', '/alumni', { name: 'X', graduationYear: 2025 }).expect(400);
    await w(A('humas'), 'post', '/alumni', { name: 'Tahun Salah', graduationYear: 1800 }).expect(400);
  });

  it('the BKK enters answers; answering again replaces it; "belum" drops the organization', async () => {
    const [andi, bunga] = (await alumni(A('humas'), '?graduationYear=2026')) as [TracerAlumnus, TracerAlumnus];
    const dewi = (await alumni(A('humas'), '?graduationYear=2025'))[0] as TracerAlumnus;

    const saved = (await w(A('humas'), 'put', `/alumni/${andi.id}/response`, { status: 'bekerja', organization: 'PT Maju Jaya', position: 'Teknisi' }).expect(200)).body as TracerAlumnus;
    expect(saved.response).toMatchObject({ status: 'bekerja', organization: 'PT Maju Jaya', position: 'Teknisi', source: 'bkk' });

    await w(A('humas'), 'put', `/alumni/${bunga.id}/response`, { status: 'melanjutkan', organization: 'Universitas Negeri' }).expect(200);
    await w(A('humas'), 'put', `/alumni/${dewi.id}/response`, { status: 'belum', organization: 'diabaikan' }).expect(200);
    expect((await alumni(A('humas'), '?graduationYear=2025'))[0]?.response).toMatchObject({ status: 'belum', organization: null, position: null });

    const replaced = (await w(A('humas'), 'put', `/alumni/${andi.id}/response`, { status: 'wirausaha', organization: 'Toko Andi' }).expect(200)).body as TracerAlumnus;
    expect(replaced.response).toMatchObject({ status: 'wirausaha', organization: 'Toko Andi', position: null });

    // BMW needs the name of the company, campus or business.
    await w(A('humas'), 'put', `/alumni/${andi.id}/response`, { status: 'bekerja' }).expect(400);
    await w(A('humas'), 'put', `/alumni/${uuidv7()}/response`, { status: 'belum' }).expect(404);
  });

  it('where somebody works is stored encrypted, not as plain text', async () => {
    const raw = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select({ organization: schema.tracerResponses.organization }).from(schema.tracerResponses));
    expect(raw.length).toBe(3);
    // The column helper reveals on read; the stored value is the ciphertext, so go below it.
    const stored = await withTenant({ schoolId: school, userId: null }, async (tx) => (await tx.execute(`select organization::text as o from tracer_responses where organization is not null`)).rows as { o: string }[]);
    for (const r of stored) expect(r.o).not.toMatch(/Toko Andi|Universitas|Maju/);
  });

  it('filters by answered and by search; recap counts BMW of those who answered, per angkatan and jurusan', async () => {
    expect((await alumni(A('humas'), '?answered=no')).length).toBe(0);
    expect((await alumni(A('humas'), '?answered=yes')).length).toBe(3);
    expect((await alumni(A('humas'), '?q=bunga')).map((r) => r.name)).toEqual(['BUNGA LESTARI']);
    expect((await alumni(A('humas'), '?stream=ips')).map((r) => r.name)).toEqual(['Dewi Anggraini']);
    // One more who has not answered: counted in the total, not against the school.
    await w(A('humas'), 'post', '/alumni', { name: 'Eko Prasetyo', graduationYear: 2026, stream: 'ipa' }).expect(201);
    const r = await recap(A('kepsek'));
    expect(r.rows.map((x) => [x.graduationYear, x.stream, x.total, x.answered, x.bmwPercent])).toEqual([
      [2026, 'ipa', 3, 2, 100],
      [2025, 'ips', 1, 1, 0],
    ]);
    expect(r.totals).toMatchObject({ total: 4, answered: 3, counts: { bekerja: 0, melanjutkan: 1, wirausaha: 1, belum: 1 }, bmwPercent: 66.7 });
  });

  it('exports the recap and every alumnus as Excel', async () => {
    const res = await get(A('kepsek'), '/export.xlsx').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/tracer-study-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    const file: unknown = res.body;
    await wb.xlsx.load(file as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Rekap BMW', 'Alumni']);
    const rows = wb.getWorksheet('Alumni')?.getSheetValues().slice(2) as unknown[][];
    expect(rows.length).toBe(4);
    expect(JSON.stringify(rows)).toContain('Toko Andi');
    expect(JSON.stringify(rows)).toContain('Belum mengisi');
  });

  it('the kepsek reads but cannot write; a plain guru cannot even read; another school sees nothing', async () => {
    await w(A('kepsek'), 'post', '/alumni', { name: 'Tidak Boleh', graduationYear: 2026 }).expect(403);
    await w(A('kepsek'), 'post', '/alumni/from-class', { classId, graduationYear: 2026 }).expect(403);
    const [someone] = await alumni(A('kepsek'));
    await w(A('kepsek'), 'put', `/alumni/${someone?.id}/response`, { status: 'belum' }).expect(403);
    await get(A('guru'), '/alumni').expect(403);
    await get(A('guru'), '/recap').expect(403);
    await get(A('guru'), '/export.xlsx').expect(403);

    const outsider = await t.staff('Humas SMA');
    await t.member(sma, outsider.id, 'humas_pkl');
    const agent = t.agent();
    await signIn(agent, outsider.email).expect(200);
    expect(((await get(agent, '/alumni', sma).expect(404)).body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    // A school with the capability sees only its own alumni.
    const other = await t.school('smk', 'SMK Lain');
    await t.member(other, outsider.id, 'humas_pkl');
    expect(((await get(agent, '/alumni', other).expect(200)).body as TracerAlumniList).items).toEqual([]);
    await w(agent, 'put', `/alumni/${someone?.id}/response`, { status: 'belum' }, other).expect(404);
  });
});
