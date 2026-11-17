import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Visit = { id: string; schoolDate: string; complaint: string; action: string | null; outcome: string; student: { enrollmentId: string; name: string; className: string }; recordedBy: { name: string } | null };
const today = schoolDate('Asia/Jakarta');
let school: string;
let offSchool: string;
let petugas: Agent;
let offPetugas: Agent;
let guru: Agent;
let wali: Agent;
let enrollments: Record<string, string>;
const key = () => `uks-${uuidv7()}`;

const record = (agent: Agent, body: object, schoolId = school, k = key()) =>
  agent.post('/api/v1/uks/visits').set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const day = (agent: Agent, query = '') => agent.get(`/api/v1/uks/visits${query}`).set('X-School-Id', school);
const sentHomeEvents = () =>
  getDb()
    .db.select({ payload: schema.outboxEvents.payload })
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'uks.sent_home')));

async function seedStudents(schoolId: string, names: string[]) {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: '8B', grade: 8 }).returning();
    const rows = await tx.insert(schema.students).values(names.map((name) => ({ schoolId, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    return Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
  });
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP UKS');
  offSchool = await t.school('smp', 'SMP Tanpa UKS');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: offSchool, key: 'student.uks', value: false });
  const p = await t.staff('Bu Petugas UKS');
  const o = await t.staff('Petugas UKS Lain');
  const g = await t.staff('Pak Guru UKS');
  const w = await t.staff('Bu Wali UKS');
  await t.member(school, p.id, 'petugas_uks');
  await t.member(offSchool, o.id, 'petugas_uks');
  await t.member(school, g.id, 'guru');
  await t.member(school, w.id, 'wali_kelas');
  petugas = t.agent();
  await signIn(petugas, p.email).expect(200);
  offPetugas = t.agent();
  await signIn(offPetugas, o.email).expect(200);
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  enrollments = await seedStudents(school, ['ANI PUSING', 'ANISA MUAL', 'BUDI DEMAM']);
});

describe('POST /uks/visits (KSW-08)', () => {
  it('records a visit and answers with the notes for the petugas', async () => {
    const res = await record(petugas, { enrollmentId: enrollments['ANI PUSING'], complaint: ' Pusing sejak pagi ', action: 'Istirahat 15 menit, minum teh hangat', outcome: 'istirahat' }).expect(200);
    expect(res.body).toMatchObject({
      schoolDate: today,
      complaint: 'Pusing sejak pagi',
      action: 'Istirahat 15 menit, minum teh hangat',
      outcome: 'istirahat',
      student: { name: 'ANI PUSING', className: '8B' },
      recordedBy: { name: 'Bu Petugas UKS' },
    });
    expect(await sentHomeEvents()).toHaveLength(0);
  });

  it('keeps the notes encrypted in the table and out of the audit log', async () => {
    const rows = await getDb().db.execute(sql`select complaint, action from uks_visits where school_id = ${school} order by created_at limit 1`);
    const stored = rows.rows[0] as { complaint: string; action: string };
    expect(stored.complaint).not.toContain('Pusing');
    expect(stored.action).not.toContain('teh');
    const audits = await getDb()
      .db.select({ after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'uks.visit_recorded')));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain('Pusing');
    expect(audits[0]?.after).toEqual({ enrollmentId: enrollments['ANI PUSING'], outcome: 'istirahat' });
  });

  it('emits uks.sent_home only for dipulangkan, with the visit id and nothing personal', async () => {
    const res = await record(petugas, { enrollmentId: enrollments['BUDI DEMAM'], complaint: 'Demam 38,5', outcome: 'dipulangkan' }).expect(200);
    expect((res.body as Visit).action).toBeNull();
    const events = await sentHomeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ uksVisitId: (res.body as Visit).id });
    await record(petugas, { enrollmentId: enrollments['ANISA MUAL'], complaint: 'Mual', outcome: 'kembali_kelas' }).expect(200);
    expect(await sentHomeEvents()).toHaveLength(1);
  });

  it('replays the same Idempotency-Key with one visit and one event', async () => {
    const k = key();
    const body = { enrollmentId: enrollments['ANISA MUAL'], complaint: 'Sakit perut', outcome: 'dipulangkan' };
    const first = await record(petugas, body, school, k).expect(200);
    const replay = await record(petugas, body, school, k).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    const events = await sentHomeEvents();
    expect(events.filter((e) => (e.payload as { uksVisitId: string }).uksVisitId === (first.body as Visit).id)).toHaveLength(1);
  });

  it('validates the body and the student', async () => {
    const student = enrollments['ANI PUSING'];
    await record(petugas, { enrollmentId: student, complaint: ' ', outcome: 'istirahat' }).expect(400);
    await record(petugas, { enrollmentId: student, complaint: 'Pusing', outcome: 'pulang' }).expect(400);
    await record(petugas, { enrollmentId: student, complaint: 'x'.repeat(501), outcome: 'istirahat' }).expect(400);
    await record(petugas, { enrollmentId: student, complaint: 'Pusing', outcome: 'istirahat', extra: 1 }).expect(400);
    await record(petugas, { enrollmentId: uuidv7(), complaint: 'Pusing', outcome: 'istirahat' }).expect(404);
  });

  it('is for the petugas UKS only: guru and wali kelas are refused, and so is a student of another school', async () => {
    const body = { enrollmentId: enrollments['ANI PUSING'], complaint: 'Pusing', outcome: 'istirahat' };
    await record(guru, body).expect(403);
    await record(wali, body).expect(403);
    await day(guru).expect(403);
    await record(offPetugas, body, offSchool).expect(404);
  });

  it('answers 404 CAPABILITY_DISABLED when student.uks is off', async () => {
    const res = await record(offPetugas, { enrollmentId: uuidv7(), complaint: 'Pusing', outcome: 'istirahat' }, offSchool).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
  });
});

describe('GET /uks/visits and /uks/students', () => {
  it("lists the day's visits newest first, and another date is empty", async () => {
    const res = await day(petugas).expect(200);
    const body = res.body as { schoolDate: string; items: Visit[] };
    expect(body.schoolDate).toBe(today);
    expect(body.items.map((v) => v.complaint)).toContain('Demam 38,5');
    expect(body.items[0]?.complaint).toBe('Sakit perut');
    expect(((await day(petugas, '?date=2020-01-01').expect(200)).body as { items: unknown[] }).items).toEqual([]);
    await day(petugas, '?date=kemarin').expect(400);
  });

  it('finds active students by name, escapes wildcards and needs two letters', async () => {
    const res = await petugas.get('/api/v1/uks/students?q=ani').set('X-School-Id', school).expect(200);
    expect((res.body as { items: { name: string }[] }).items.map((s) => s.name)).toEqual(['ANI PUSING', 'ANISA MUAL']);
    const wild = await petugas.get('/api/v1/uks/students?q=%25%25').set('X-School-Id', school).expect(200);
    expect((wild.body as { items: unknown[] }).items).toEqual([]);
    await petugas.get('/api/v1/uks/students?q=a').set('X-School-Id', school).expect(400);
    await guru.get('/api/v1/uks/students?q=ani').set('X-School-Id', school).expect(403);
  });
});
