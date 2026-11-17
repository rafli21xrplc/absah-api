import { schema } from '@absah/db';
import ExcelJS from 'exceljs';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let school: string;
let guruA: Agent;
let guruB: Agent;
let wakasek: Agent;
let idA: string;
let idB: string;
let sessions: Record<string, string>; // label -> session id
const key = () => `jurnal-${uuidv7()}`;

const submit = (agent: Agent, id: string, body: object, idempotencyKey = key()) =>
  agent.post(`/api/v1/sessions/${id}/submit`).set('X-School-Id', school).set('Idempotency-Key', idempotencyKey).send(body);
const journal = (agent: Agent, query: string) => agent.get(`/api/v1/teaching-journal?${query}`).set('X-School-Id', school);
const exportXlsx = (agent: Agent, query: string) =>
  agent
    .get(`/api/v1/teaching-journal/export.xlsx?${query}`)
    .set('X-School-Id', school)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });

type Entry = { sessionId: string; schoolDate: string; className: string; topic: string | null; subject: { name: string } | null; teacher: { id: string } | null };
type Journal = { month: string; entries: Entry[]; totals: { sessions: number; withTopic: number } };

beforeAll(async () => {
  school = await t.school('smp', 'SMP Jurnal');
  const a = await t.staff('Bu Ani Guru');
  const b = await t.staff('Pak Budi Guru');
  const w = await t.staff('Bu Wakasek');
  idA = a.id;
  idB = b.id;
  await t.member(school, a.id, 'guru');
  await t.member(school, b.id, 'guru');
  await t.member(school, w.id, 'wakasek');
  guruA = t.agent();
  await signIn(guruA, a.email).expect(200);
  guruB = t.agent();
  await signIn(guruB, b.email).expect(200);
  wakasek = t.agent();
  await signIn(wakasek, w.email).expect(200);
  await enableTotp(wakasek);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '7A', grade: 7 }).returning();
    const [subject] = await tx.insert(schema.subjects).values({ schoolId: school, name: 'IPA' }).returning();
    const [rows] = [await tx.insert(schema.students).values([{ schoolId: school, name: 'ANI' }, { schoolId: school, name: 'BUDI' }]).returning()];
    await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })));
    await tx.insert(schema.schedulePeriods).values([
      { schoolId: school, day: 1, number: 1, startsAt: '07:00', endsAt: '07:40' },
      { schoolId: school, day: 1, number: 2, startsAt: '07:40', endsAt: '08:20' },
    ]);
    const slot = { schoolId: school, academicYearId: year?.id ?? '', ownerType: 'class' as const, ownerId: cls?.id ?? '', day: 1, subjectId: subject?.id ?? '' };
    const [s1, s2] = await tx
      .insert(schema.scheduleSlots)
      .values([
        { ...slot, period: 1, teacherId: a.id },
        { ...slot, period: 2, teacherId: b.id },
      ])
      .returning();
    const base = { schoolId: school, mode: 'per_period' as const, ownerType: 'class' as const, ownerId: cls?.id ?? '' };
    const made = await tx
      .insert(schema.attendanceSessions)
      .values([
        { ...base, schoolDate: '2026-11-09', slotId: s1?.id ?? '', teacherId: a.id },
        { ...base, schoolDate: '2026-11-02', slotId: s1?.id ?? '', teacherId: a.id },
        { ...base, schoolDate: '2026-11-02', slotId: s2?.id ?? '', teacherId: b.id },
        { ...base, schoolDate: '2026-12-07', slotId: s1?.id ?? '', teacherId: a.id },
        { schoolId: school, mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '', schoolDate: '2026-11-02', teacherId: a.id },
      ])
      .returning();
    sessions = { a2: made[0]?.id ?? '', a1: made[1]?.id ?? '', b1: made[2]?.id ?? '', aDec: made[3]?.id ?? '', daily: made[4]?.id ?? '' };
  });
});

describe('topic on submit (PRS-09)', () => {
  it('stores the trimmed topic and returns it on the session', async () => {
    const res = await submit(guruA, sessions.a1 ?? '', { exceptions: [], topic: '  Rantai makanan dan jaring-jaring  ' }).expect(200);
    expect(res.body).toMatchObject({ status: 'submitted', topic: 'Rantai makanan dan jaring-jaring' });
  });

  it('keeps the topic when the session is submitted again without one, clears it with an empty string', async () => {
    const again = await submit(guruA, sessions.a1 ?? '', { exceptions: [] }).expect(200);
    expect(again.body).toMatchObject({ topic: 'Rantai makanan dan jaring-jaring' });
    const cleared = await submit(guruA, sessions.a1 ?? '', { exceptions: [], topic: '   ' }).expect(200);
    expect((cleared.body as { topic: string | null }).topic).toBeNull();
    await submit(guruA, sessions.a1 ?? '', { exceptions: [], topic: 'Rantai makanan' }).expect(200);
  });

  it('accepts exactly 200 characters and rejects 201', async () => {
    await submit(guruA, sessions.a2 ?? '', { exceptions: [], topic: 'x'.repeat(200) }).expect(200);
    const res = await submit(guruA, sessions.a2 ?? '', { exceptions: [], topic: 'x'.repeat(201) }).expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a topic on a daily session', async () => {
    const res = await submit(guruA, sessions.daily ?? '', { exceptions: [], topic: 'Apel pagi' }).expect(400);
    expect(JSON.stringify(res.body)).toContain('topic');
  });

  it("does not let another guru write someone else's journal", async () => {
    await submit(guruB, sessions.a1 ?? '', { exceptions: [], topic: 'Diganti' }).expect(404);
  });

  it('replays an idempotent submit without writing again', async () => {
    const replayKey = key();
    const first = await submit(guruB, sessions.b1 ?? '', { exceptions: [], topic: 'Ekosistem' }, replayKey).expect(200);
    const replay = await submit(guruB, sessions.b1 ?? '', { exceptions: [], topic: 'Ekosistem' }, replayKey).expect(200);
    expect(replay.body).toEqual(first.body);
  });
});

describe('GET /teaching-journal', () => {
  it('shows a guru their own per-period sessions of the month, oldest first, without daily sessions', async () => {
    const res = await journal(guruA, 'month=2026-11').expect(200);
    const body = res.body as Journal;
    expect(body.entries.map((e) => [e.schoolDate, e.topic])).toEqual([
      ['2026-11-02', 'Rantai makanan'],
      ['2026-11-09', 'x'.repeat(200)],
    ]);
    expect(body.entries[0]).toMatchObject({ className: '7A', subject: { name: 'IPA' }, period: { number: 1, startsAt: '07:00' } });
    expect(body.entries.every((e) => e.teacher?.id === idA)).toBe(true);
    expect(body.totals).toEqual({ sessions: 2, withTopic: 2 });
  });

  it('keeps months apart and counts sessions without a topic', async () => {
    const res = await journal(guruA, 'month=2026-12').expect(200);
    expect((res.body as Journal).totals).toEqual({ sessions: 1, withTopic: 0 });
    expect(((res.body as Journal).entries[0] as Entry).topic).toBeNull();
    const empty = await journal(guruA, 'month=2027-01').expect(200);
    expect((empty.body as Journal).entries).toEqual([]);
  });

  it("refuses a guru asking for another teacher's journal", async () => {
    await journal(guruA, `month=2026-11&teacherId=${idB}`).expect(403);
    await journal(guruA, `month=2026-11&teacherId=${idA}`).expect(200);
  });

  it('lets wakasek read every teacher, or one teacher', async () => {
    const all = await journal(wakasek, 'month=2026-11').expect(200);
    expect((all.body as Journal).entries.map((e) => e.teacher?.id).sort()).toEqual([idA, idA, idB].sort());
    const one = await journal(wakasek, `month=2026-11&teacherId=${idB}`).expect(200);
    expect((one.body as Journal).entries).toHaveLength(1);
  });

  it('validates the month and needs a session', async () => {
    await journal(guruA, 'month=2026-13').expect(400);
    await journal(guruA, 'month=november').expect(400);
    await journal(guruA, '').expect(400);
    await t.agent().get('/api/v1/teaching-journal?month=2026-11').set('X-School-Id', school).expect(401);
  });
});

describe('GET /teaching-journal/export.xlsx', () => {
  async function sheetOf(res: { body: unknown; headers: Record<string, string> }) {
    expect(res.headers['content-type']).toBe(XLSX);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ArrayBuffer);
    return workbook.worksheets[0] as ExcelJS.Worksheet;
  }

  it("gives a guru their own month as Excel, named after the teacher and month", async () => {
    const res = await exportXlsx(guruA, 'month=2026-11').expect(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="jurnal-mengajar-bu-ani-guru-2026-11.xlsx"');
    const sheet = await sheetOf(res);
    expect(sheet.getRow(1).getCell(1).value).toBe('Jurnal mengajar: Bu Ani Guru');
    expect(sheet.getRow(5).values).toEqual([undefined, 1, '2026-11-02', 1, '07:00-07:40', '7A', 'IPA', 'Rantai makanan', 'Sudah diisi']);
    expect(sheet.rowCount).toBe(6);
  });

  it('needs wakasek to name the teacher, and answers 404 for someone who is not a member', async () => {
    await exportXlsx(wakasek, 'month=2026-11').expect(400);
    const ok = await exportXlsx(wakasek, `month=2026-11&teacherId=${idB}`).expect(200);
    expect((await sheetOf(ok)).getRow(5).getCell(7).value).toBe('Ekosistem');
    await exportXlsx(wakasek, `month=2026-11&teacherId=${uuidv7()}`).expect(404);
  });

  it("refuses a guru exporting someone else's journal", async () => {
    await exportXlsx(guruA, `month=2026-11&teacherId=${idB}`).expect(403);
  });
});
