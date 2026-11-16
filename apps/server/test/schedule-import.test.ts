import ExcelJS from 'exceljs';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { fixture, importer } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let school: string;
const key = () => `jadwal-${uuidv7()}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Preview = { lessons: number; classes: string[]; newSubjects: string[]; errors: { row: number; message: string }[]; fingerprint: string };
type Slot = { ownerName: string; day: number; period: number; subject: { name: string }; teacher: { name: string } | null };

beforeAll(async () => {
  const o = await t.staff('Operator Template');
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
  const andi = await t.staff('Pak Andi');
  school = await t.school('smp', 'SMP Template Jadwal');
  await t.member(school, o.id, 'operator');
  await t.member(school, andi.id, 'guru');
  const imports = importer(t, operator, school);
  await imports.commit((await imports.prepare(await fixture('daftar-pd-awal.xlsx'))).id).expect(200);
  const days = [1, 2].map((day) => ({ day, periods: [1, 2].map((n) => ({ number: n, startsAt: `0${6 + n}:00`, endsAt: `0${6 + n}:45` })) }));
  await operator.put('/api/v1/schedule/periods').set('X-School-Id', school).set('Idempotency-Key', key()).send({ days }).expect(200);
});

const as = <T extends { set: (k: string, v: string) => T }>(req: T) => req.set('X-School-Id', school).set('Idempotency-Key', key());

async function template(): Promise<ExcelJS.Workbook> {
  const res = await operator
    .get('/api/v1/schedule/template.xlsx')
    .set('X-School-Id', school)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    })
    .expect(200);
  expect(res.headers['content-type']).toBe(XLSX);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body as ArrayBuffer);
  return workbook;
}

async function upload(workbook: ExcelJS.Workbook): Promise<string> {
  const file = Buffer.from(await workbook.xlsx.writeBuffer());
  const started = await as(operator.post('/api/v1/schedule/imports')).send({ fileName: 'jadwal.xlsx', fileSize: file.length, contentType: XLSX }).expect(200);
  const body = started.body as { uploadId: string; upload: { url: string; headers: Record<string, string> } };
  const url = new URL(body.upload.url);
  await operator.put(url.pathname + url.search).set(body.upload.headers).send(file).expect(200);
  return body.uploadId;
}

const preview = async (id: string) =>
  (await operator.post(`/api/v1/schedule/imports/${id}/preview`).set('X-School-Id', school).expect(200)).body as Preview;

function fill(workbook: ExcelJS.Workbook, rows: (string | number)[][]) {
  const sheet = workbook.getWorksheet('Jadwal');
  if (!sheet) throw new Error('no Jadwal sheet');
  rows.forEach((r, i) => (sheet.getRow(i + 2).values = r));
}

describe('schedule template import', () => {
  it('downloads a template with reference sheets', async () => {
    const workbook = await template();
    expect(workbook.getWorksheet('Rombel')?.getColumn(1).values.slice(2)).toEqual(['VII A', 'VII B', 'VIII A']);
    expect(workbook.getWorksheet('Guru')?.getColumn(1).values.slice(2)).toContain('Pak Andi');
  });

  it('previews per-row errors, including clashes, and refuses to commit them', async () => {
    const workbook = await template();
    fill(workbook, [
      ['VII A', 'Senin', 1, 'Matematika', 'Pak Andi'],
      ['VII B', 'Senin', 1, 'IPA', 'Pak Andi'],
      ['X IPA 9', 'Kamis', 1, 'IPA', ''],
    ]);
    const id = await upload(workbook);
    const result = await preview(id);
    expect(result.errors).toEqual([
      { row: 3, message: 'Guru yang sama juga mengajar VII A (baris 2) di jam ini.' },
      { row: 4, message: 'Rombel "X IPA 9" tidak ada di tahun ajaran aktif.' },
      { row: 4, message: 'Jam ke-1 belum diatur untuk hari itu.' },
    ]);
    const refused = await as(operator.post(`/api/v1/schedule/imports/${id}/commit`)).send({ fingerprint: result.fingerprint }).expect(409);
    expect((refused.body as { details: { reason: string } }).details.reason).toBe('has_errors');
  });

  it('applies a clean file: replaces the rombel in the file, creates subjects, keeps other rombel', async () => {
    const viiB = ((await operator.get('/api/v1/classes').set('X-School-Id', school).expect(200)).body as { items: { id: string; name: string }[] }).items.find(
      (c) => c.name === 'VII B',
    )?.id;
    const subject = (await as(operator.post('/api/v1/subjects')).send({ name: 'Matematika' }).expect(200)).body as { id: string };
    await as(operator.put('/api/v1/schedule/slots')).send({ ownerType: 'class', ownerId: viiB, day: 2, period: 2, subjectId: subject.id, teacherId: null }).expect(200);

    const workbook = await template();
    fill(workbook, [
      ['VII A', 'Senin', 1, 'matematika', 'Pak Andi'],
      ['VII A', 'Senin', 2, 'Seni Budaya', ''],
      ['VIII A', 'selasa', 1, 'Seni Budaya', 'pak andi'],
    ]);
    const id = await upload(workbook);
    const result = await preview(id);
    expect(result).toMatchObject({ lessons: 3, classes: ['VII A', 'VIII A'], newSubjects: ['Seni Budaya'], errors: [] });

    await as(operator.post(`/api/v1/schedule/imports/${id}/commit`)).send({ fingerprint: 'not-the-preview' }).expect(409);
    const done = await as(operator.post(`/api/v1/schedule/imports/${id}/commit`)).send({ fingerprint: result.fingerprint }).expect(200);
    expect(done.body).toEqual({ lessons: 3, classes: ['VII A', 'VIII A'], newSubjects: ['Seni Budaya'] });

    // The next template lists every rombel lesson, ordered by day and period.
    const sheet = (await template()).getWorksheet('Jadwal');
    const lessons: unknown[][] = [];
    sheet?.eachRow((r, n) => {
      if (n > 1 && Array.isArray(r.values) && r.values[1]) lessons.push(r.values.slice(1, 6));
    });
    expect(lessons).toEqual([
      ['VII A', 'Senin', 1, 'Matematika', 'Pak Andi'],
      ['VII A', 'Senin', 2, 'Seni Budaya', ''],
      ['VIII A', 'Selasa', 1, 'Seni Budaya', 'Pak Andi'],
      ['VII B', 'Selasa', 2, 'Matematika', ''],
    ]);
    const schedule = await operator.get('/api/v1/schedule').query({ classId: viiB }).set('X-School-Id', school).expect(200);
    expect((schedule.body as { slots: Slot[] }).slots.map((s) => s.subject.name)).toEqual(['Matematika']);

    // The file is gone after the commit.
    await operator.post(`/api/v1/schedule/imports/${id}/preview`).set('X-School-Id', school).expect(409);
  });

  it('rejects a file that is not the template', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Data').addRow(['Nama', 'Kelas']);
    const id = await upload(workbook);
    const res = await operator.post(`/api/v1/schedule/imports/${id}/preview`).set('X-School-Id', school).expect(400);
    expect((res.body as { message: string }).message).toMatch(/Rombel, Hari, Jam ke, Mapel, Guru/);
  });
});
