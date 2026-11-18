import type { ExportDownload, ExportJob, ExportJobList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportConsumers } from '../src/modules/report';
import { purgeOldExports } from '../src/modules/report/application/exports';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let wakasek: Agent;
let wali: Agent;
let guru: Agent;
const ids = { semester: '', classA: '', classB: '' };
const bodyOf = <T>(res: { body: unknown }) => res.body as T;

const post = (agent: Agent, body: object, key = uuidv7()) => agent.post('/api/v1/exports').set('X-School-Id', school).set('Idempotency-Key', key).send(body);
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

/** Runs the worker's consumer on the export.requested event of a job, as pg-boss would. */
async function build(jobId: string, schoolId = school) {
  const [event] = await getDb()
    .db.select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, schoolId), eq(schema.outboxEvents.type, 'export.requested'), sql`${schema.outboxEvents.payload}->>'exportJobId' = ${jobId}`));
  const consumer = reportConsumers(t.storage)[0];
  if (!event || !consumer) throw new Error('no export event');
  return runConsumer(consumer, { id: event.id, schoolId, type: event.type, payload: event.payload, traceId: null, occurredAt: event.createdAt.toISOString() });
}

/** Downloads a finished file through its presigned URL. */
async function download(agent: Agent, jobId: string, schoolId = school): Promise<Buffer> {
  const link = bodyOf<ExportDownload>(await agent.get(`/api/v1/exports/${jobId}/download`).set('X-School-Id', schoolId).expect(200));
  const url = new URL(link.url);
  const res = await t.agent().get(url.pathname + url.search).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers['content-disposition']).toContain(`filename="${link.fileName}"`);
  return res.body as Buffer;
}

beforeAll(async () => {
  school = await t.school('sma', 'SMA Ekspor');
  const [k, w, g, p] = await Promise.all([t.staff('Wakasek Ekspor'), t.staff('Bu Wali Ekspor'), t.staff('Pak Guru Ekspor'), t.staff('Kepala Ekspor')]);
  await t.member(school, k.id, 'wakasek');
  await t.member(school, w.id, 'guru');
  await t.member(school, g.id, 'guru');
  await t.member(school, p.id, 'kepsek');
  [wakasek, wali, guru] = [t.agent(), t.agent(), t.agent()];
  await signIn(wakasek, k.email).expect(200);
  await signIn(wali, w.email).expect(200);
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const academicYearId = year?.id ?? '';
    const [sem] = await tx.insert(schema.semesters).values({ schoolId: school, academicYearId, number: 2, startsOn: '2027-01-04', endsOn: '2027-06-19' }).returning();
    ids.semester = sem?.id ?? '';
    const [a, b] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId, name: 'X-1', grade: 10, stream: 'ipa', homeroomTeacherId: w.id },
        { schoolId: school, academicYearId, name: 'X-2', grade: 10, stream: 'ips' },
      ])
      .returning();
    ids.classA = a?.id ?? '';
    ids.classB = b?.id ?? '';
    // Hand count for X-1: ANI S2 I1 A0, BUDI S0 I0 A3 (days in January; one December day outside).
    const students = await tx
      .insert(schema.students)
      .values([
        { schoolId: school, name: 'ANI LESTARI', nisn: '0091234567', localId: '0012' },
        { schoolId: school, name: 'BUDI SANTOSO' },
      ])
      .returning();
    const enrollments = await tx
      .insert(schema.enrollments)
      .values(students.map((s) => ({ schoolId: school, studentId: s.id, classId: ids.classA, academicYearId, startsOn: '2026-07-13' })))
      .returning();
    const [ani, budi] = enrollments.map((e) => e.id);
    const day = (enrollmentId: string | undefined, schoolDate: string, status: 'H' | 'S' | 'I' | 'A') => ({ schoolId: school, enrollmentId: enrollmentId ?? '', schoolDate, status });
    await tx.insert(schema.dailyAttendance).values([
      day(ani, '2027-01-04', 'S'),
      day(ani, '2027-01-05', 'S'),
      day(ani, '2027-01-06', 'I'),
      day(ani, '2027-01-07', 'H'),
      day(budi, '2027-01-04', 'A'),
      day(budi, '2027-01-05', 'A'),
      day(budi, '2027-01-06', 'A'),
      day(budi, '2026-12-01', 'S'),
    ]);
  });
});

describe('export jobs (RKP-02, RKP-03)', () => {
  it('queues, builds in the worker and downloads the e-Rapor sheet', async () => {
    const res = await post(wali, { format: 'xlsx', semesterId: ids.semester, classId: ids.classA }).expect(202);
    const job = bodyOf<ExportJob>(res);
    expect(job).toMatchObject({ status: 'queued', target: 'erapor', class: { name: 'X-1' }, semester: { number: 2 } });
    await get(wali, `/exports/${job.id}/download`).expect(409);

    expect(await build(job.id)).toBe('handled');
    const done = bodyOf<ExportJob>(await get(wali, `/exports/${job.id}`).expect(200));
    expect(done).toMatchObject({ status: 'done', fileName: 'rekap-kehadiran-2026-2027-sem2-X-1.xlsx' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await download(wali, job.id)) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('X-1');
    expect(sheet?.getRow(2).values).toEqual([undefined, 1, '0012', '0091234567', 'ANI LESTARI', 2, 1, 0]);
    expect(sheet?.getRow(3).values).toEqual([undefined, 2, '', '', 'BUDI SANTOSO', 0, 0, 3]);
  });

  it('builds the signed archive PDF for the whole school', async () => {
    const job = bodyOf<ExportJob>(await post(wakasek, { format: 'pdf', semesterId: ids.semester }).expect(202));
    expect(job.class).toBeNull();
    await build(job.id);
    const pdf = await download(wakasek, job.id);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('exports and lists one jurusan only (AKD-11)', async () => {
    const job = bodyOf<ExportJob>(await post(wakasek, { format: 'xlsx', semesterId: ids.semester, stream: 'ipa' }).expect(202));
    expect(job).toMatchObject({ class: null, stream: 'ipa' });
    await build(job.id);
    expect(bodyOf<ExportJob>(await get(wakasek, `/exports/${job.id}`).expect(200)).fileName).toBe('rekap-kehadiran-2026-2027-sem2-jurusan-IPA.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await download(wakasek, job.id)) as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['X-1']);

    const list = bodyOf<{ items: { name: string; stream: string | null }[] }>(await get(wakasek, '/reports/attendance/classes?from=2027-01-04&to=2027-01-08&stream=ips').expect(200));
    expect(list.items).toEqual([expect.objectContaining({ name: 'X-2', stream: 'ips' })]);
    await get(wakasek, '/reports/attendance/classes?from=2027-01-04&to=2027-01-08&stream=teknik').expect(400);
    // A wali kelas keeps their own rombel under its jurusan, and nothing under another.
    expect(bodyOf<{ items: unknown[] }>(await get(wali, '/reports/attendance/classes?from=2027-01-04&to=2027-01-08&stream=ips').expect(200)).items).toEqual([]);
    await post(wakasek, { format: 'xlsx', semesterId: ids.semester, classId: ids.classA, stream: 'ipa' }).expect(400);
  });

  it('replays the same request for the same key', async () => {
    const key = uuidv7();
    const first = await post(wakasek, { format: 'xlsx', semesterId: ids.semester }, key).expect(202);
    const again = await post(wakasek, { format: 'xlsx', semesterId: ids.semester }, key).expect(202);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(bodyOf<ExportJob>(again).id).toBe(bodyOf<ExportJob>(first).id);
  });

  it('validates the request', async () => {
    await post(wakasek, { format: 'docx', semesterId: ids.semester }).expect(400);
    await post(wakasek, { format: 'xlsx' }).expect(400);
    await post(wakasek, { format: 'xlsx', semesterId: uuidv7() }).expect(404);
  });

  it('limits a wali kelas to their rombel and hides other people’s exports', async () => {
    await post(wali, { format: 'xlsx', semesterId: ids.semester }).expect(403);
    await post(wali, { format: 'xlsx', semesterId: ids.semester, classId: ids.classB }).expect(404);
    await post(guru, { format: 'xlsx', semesterId: ids.semester, classId: ids.classA }).expect(404);
    const mine = bodyOf<ExportJobList>(await get(wali, '/exports').expect(200));
    expect(mine.items.length).toBeGreaterThan(0);
    const [other] = bodyOf<ExportJobList>(await get(wakasek, '/exports').expect(200)).items;
    await get(wali, `/exports/${other?.id ?? ''}`).expect(404);
    await get(wali, `/exports/${other?.id ?? ''}/download`).expect(404);
  });

  it('answers 409 while the report target has no exporter yet (RDM)', async () => {
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'report.target', value: 'rdm' }));
    try {
      const res = await post(wakasek, { format: 'xlsx', semesterId: ids.semester }).expect(409);
      expect(res.body).toMatchObject({ details: { reason: 'target_unavailable' } });
    } finally {
      await withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.schoolCapabilities).where(eq(schema.schoolCapabilities.key, 'report.target')));
    }
  });

  it('removes files after the retention period', async () => {
    const job = bodyOf<ExportJob>(await post(wali, { format: 'xlsx', semesterId: ids.semester, classId: ids.classA }).expect(202));
    await build(job.id);
    const [row] = await getDb().db.select({ fileKey: schema.exportJobs.fileKey }).from(schema.exportJobs).where(eq(schema.exportJobs.id, job.id));
    expect(await purgeOldExports(t.storage, new Date(Date.now() + 8 * 86_400_000))).toBeGreaterThan(0);
    expect(bodyOf<ExportJob>(await get(wali, `/exports/${job.id}`).expect(200)).status).toBe('expired');
    expect(await t.storage.read(row?.fileKey ?? '')).toBeNull();
    const res = await get(wali, `/exports/${job.id}/download`).expect(409);
    expect(res.body).toMatchObject({ details: { reason: 'expired' } });
  });
});

describe('a 900-student export (pilot size)', () => {
  let big: string;
  let admin: Agent;
  let semester: string;

  beforeAll(async () => {
    big = await t.school('sma', 'SMA Besar');
    const a = await t.staff('Admin Besar');
    await t.member(big, a.id, 'admin');
    admin = t.agent();
    await signIn(admin, a.email).expect(200);
    await enableTotp(admin);
    await withTenant({ schoolId: big, userId: null }, async (tx) => {
      const [year] = await tx.insert(schema.academicYears).values({ schoolId: big, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
      const academicYearId = year?.id ?? '';
      const [sem] = await tx.insert(schema.semesters).values({ schoolId: big, academicYearId, number: 2, startsOn: '2027-01-04', endsOn: '2027-06-19' }).returning();
      semester = sem?.id ?? '';
      const names = ['X', 'XI', 'XII'].flatMap((g) => Array.from({ length: 12 }, (_, i) => ({ name: `${g}-${i + 1}`, grade: g.length + 9 })));
      const classes = await tx.insert(schema.classes).values(names.map((c) => ({ schoolId: big, academicYearId, ...c }))).returning();
      const students = await tx
        .insert(schema.students)
        .values(Array.from({ length: 900 }, (_, i) => ({ schoolId: big, name: `SISWA ${String(i + 1).padStart(3, '0')}` })))
        .returning({ id: schema.students.id });
      await tx
        .insert(schema.enrollments)
        .values(students.map((s, i) => ({ schoolId: big, studentId: s.id, classId: classes[i % 36]?.id ?? '', academicYearId, startsOn: '2026-07-13' })));
      // 20 school days each (18 000 rekap rows), one alpa per student.
      await tx.execute(sql`
        insert into daily_attendance (school_id, enrollment_id, school_date, status)
        select ${big}::uuid, e.id, date '2027-01-04' + g, case when g = 0 then 'A'::attendance_status else 'H'::attendance_status end
        from enrollments e, generate_series(0, 19) g`);
    });
  }, 120_000);

  it('answers at once and the worker builds every rombel', async () => {
    const started = Date.now();
    const res = await admin.post('/api/v1/exports').set('X-School-Id', big).set('Idempotency-Key', uuidv7()).send({ format: 'xlsx', semesterId: semester }).expect(202);
    expect(Date.now() - started).toBeLessThan(2_000);
    const job = bodyOf<ExportJob>(res);

    const buildStarted = Date.now();
    await build(job.id, big);
    expect(Date.now() - buildStarted).toBeLessThan(30_000);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await download(admin, job.id, big)) as unknown as ArrayBuffer);
    expect(workbook.worksheets).toHaveLength(36);
    const rows = workbook.worksheets.reduce((n, w) => n + w.rowCount - 1, 0);
    expect(rows).toBe(900);
    expect(workbook.getWorksheet('X-1')?.getRow(2).values).toEqual([undefined, 1, '', '', 'SISWA 001', 0, 0, 1]);
  }, 60_000);

  it('builds the 900-student PDF too', async () => {
    const res = await admin.post('/api/v1/exports').set('X-School-Id', big).set('Idempotency-Key', uuidv7()).send({ format: 'pdf', semesterId: semester }).expect(202);
    const job = bodyOf<ExportJob>(res);
    await build(job.id, big);
    const [row] = await getDb().db.select({ status: schema.exportJobs.status }).from(schema.exportJobs).where(eq(schema.exportJobs.id, job.id)).orderBy(desc(schema.exportJobs.createdAt));
    expect(row?.status).toBe('done');
  }, 60_000);
});
