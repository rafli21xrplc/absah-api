import { XLSX_CONTENT_TYPE } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { fixture, importer, type ImportBody, type Preview } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let operatorId: string;
let guru: Agent;
let guruId: string;

beforeAll(async () => {
  const o = await t.staff('Operator Import');
  operatorId = o.id;
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
  const g = await t.staff('Guru Import');
  guruId = g.id;
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
});

async function newSchool(level: 'smp' | 'sma' = 'smp') {
  const id = await t.school(level, 'SMP Import');
  await t.member(id, operatorId, 'operator');
  await t.member(id, guruId, 'guru');
  return id;
}

const imports = (school: string) => importer(t, operator, school);
const start = (school: string, file: Buffer) => imports(school).start(file);
const upload = (school: string, body: ImportBody, file: Buffer) => imports(school).upload(body, file);
const runParseJob = (school: string, id: string) => imports(school).runParseJob(id);
const preview = (school: string, id: string) => imports(school).preview(id);

describe('Dapodik import: upload, parse, preview', () => {
  it('turns an uploaded export into a preview without touching student data', async () => {
    const school = await newSchool();
    const file = await fixture('daftar-pd-awal.xlsx');
    const started = await start(school, file);
    expect(started.import.status).toBe('awaiting_upload');
    expect(started.upload.method).toBe('PUT');
    await upload(school, started, file);

    const parse = await operator.post(`/api/v1/imports/${started.import.id}/parse`).set('X-School-Id', school).expect(200);
    expect((parse.body as Preview).status).toBe('parsing');
    // Asking again does not queue a second parse.
    await operator.post(`/api/v1/imports/${started.import.id}/parse`).set('X-School-Id', school).expect(200);

    expect(await runParseJob(school, started.import.id)).toBe('handled');
    const body = await preview(school, started.import.id);
    expect(body).toMatchObject({
      status: 'ready',
      error: null,
      counts: { created: 10, changed: 0, unchanged: 0, missing: 0, rejected: 0, warnings: 0 },
    });
    expect(body.academicYear).toMatch(/^\d{4}\/\d{4}$/);
    expect(body.items.find((i) => i.name === 'FAJAR NUGROHO')).toMatchObject({ kind: 'created', className: 'VII B' });
    expect(JSON.stringify(body)).not.toContain('9901010211130001'); // NIK never leaves the server

    const students = await withTenant({ schoolId: school, userId: null }, (tx) => tx.query.students.findMany());
    expect(students).toEqual([]);

    const list = await operator.get('/api/v1/imports').set('X-School-Id', school).expect(200);
    expect((list.body as { items: { id: string; items: unknown[] }[] }).items).toEqual([
      expect.objectContaining({ id: started.import.id, items: [] }),
    ]);
  });

  it('fails with a readable message for a file that was never uploaded or is not an export', async () => {
    const school = await newSchool();
    const missing = await start(school, Buffer.from('x'));
    await operator.post(`/api/v1/imports/${missing.import.id}/parse`).set('X-School-Id', school).expect(200);
    await runParseJob(school, missing.import.id);
    const notUploaded = await preview(school, missing.import.id);
    expect(notUploaded.status).toBe('failed');
    expect(notUploaded.error).toContain('belum terunggah');

    const csv = Buffer.from('nama,nisn\nANI,0131000001\n');
    const wrong = await start(school, csv);
    await upload(school, wrong, csv);
    await operator.post(`/api/v1/imports/${wrong.import.id}/parse`).set('X-School-Id', school).expect(200);
    await runParseJob(school, wrong.import.id);
    const notExport = await preview(school, wrong.import.id);
    expect(notExport.status).toBe('failed');
    expect(notExport.error).toContain('.xlsx');
  });

  it('is for admins and operators of schools that use Dapodik, inside their own school', async () => {
    const school = await newSchool();
    const body = { fileName: 'a.xlsx', fileSize: 10, contentType: XLSX_CONTENT_TYPE };
    await guru.post('/api/v1/imports/dapodik').set('X-School-Id', school).set('Idempotency-Key', `k-${uuidv7()}`).send(body).expect(403);

    const madrasah = await t.school('sma', 'MA Import');
    await getDb().db.update(schema.schools).set({ isMadrasah: true }).where(eq(schema.schools.id, madrasah));
    await t.member(madrasah, operatorId, 'operator');
    const res = await operator.post('/api/v1/imports/dapodik').set('X-School-Id', madrasah).set('Idempotency-Key', `k-${uuidv7()}`).send(body).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');

    const mine = await start(school, Buffer.from('x'));
    const other = await newSchool();
    await operator.get(`/api/v1/imports/${mine.import.id}`).set('X-School-Id', other).expect(404);

    await operator
      .post('/api/v1/imports/dapodik')
      .set('X-School-Id', school)
      .set('Idempotency-Key', `k-${uuidv7()}`)
      .send({ ...body, fileSize: 11 * 1024 * 1024 })
      .expect(400);
  });
});
