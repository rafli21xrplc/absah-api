import { schema, sensitive } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate, schoolMinutes } from '../src/shared/school-date';
import { gateSchool } from './gate-fixtures';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let piket: Agent;
let guru: Agent;
let school: string;
let students: Record<string, string>; // name -> enrollment id

const post = (agent: Agent, body: object, key = `piket-${uuidv7()}`) =>
  agent.post('/api/v1/gate/arrivals').set('X-School-Id', school).set('Idempotency-Key', key).send(body);
type Today = { counts: Record<string, number>; late: { name: string; method: string }[]; notArrived: { name: string; leave: string | null }[] };

beforeAll(async () => {
  school = await t.school('sd', 'SD Piket');
  await gateSchool(t, school);
  const p = await t.staff('Pak Piket');
  const g = await t.staff('Bu Guru Biasa');
  await t.member(school, p.id, 'piket');
  await t.member(school, g.id, 'guru');
  piket = t.agent();
  await signIn(piket, p.email).expect(200);
  guru = t.agent();
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '6A', grade: 6 }).returning();
    const rows = await tx.insert(schema.students).values(['ANI', 'BUDI', 'CITRA', 'DODI'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    // BUDI scanned his card late; CITRA has an approved sick note for today.
    await tx.insert(schema.gateScans).values({ schoolId: school, schoolDate: today, scannedAt: new Date(), method: 'qr', result: 'accepted', outcome: 'late', enrollmentId: students.BUDI });
    await tx.insert(schema.leaveRequests).values({
      schoolId: school,
      enrollmentId: students.CITRA ?? '',
      kind: 'sakit',
      startsOn: today,
      endsOn: today,
      reason: sensitive('Demam'),
      status: 'approved',
    });
  });
});

describe('piket at the gate (GRB-05, GRB-06)', () => {
  it('records a manual arrival with a reason, once per student per day', async () => {
    const onTime = schoolMinutes('Asia/Jakarta', new Date()) <= 7 * 60;
    await post(piket, { enrollmentId: students.ANI, reason: '' }).expect(400);
    await post(piket, { enrollmentId: students.ANI, reason: 'HP orang tua tertinggal', arrivedAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);
    await post(guru, { enrollmentId: students.ANI, reason: 'HP orang tua tertinggal' }).expect(403);

    const key = `piket-${uuidv7()}`;
    const res = await post(piket, { enrollmentId: students.ANI, reason: 'HP orang tua tertinggal' }, key).expect(200);
    expect(res.body).toMatchObject({ name: 'ANI', method: 'manual', outcome: onTime ? 'on_time' : 'late', reason: 'HP orang tua tertinggal' });
    expect((await post(piket, { enrollmentId: students.ANI, reason: 'HP orang tua tertinggal' }, key).expect(200)).headers['idempotent-replayed']).toBe('true');
    const again = await post(piket, { enrollmentId: students.ANI, reason: 'Dicatat dua kali' }).expect(409);
    expect((again.body as { details: { reason: string } }).details.reason).toBe('already_arrived');

    const audits = await getDb()
      .db.select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'gate.manual_arrival')));
    expect(audits).toHaveLength(1);
  });

  it('lists late arrivals and who is not in yet, flagging approved izin', async () => {
    await guru.get('/api/v1/gate/today').set('X-School-Id', school).expect(403);
    const body = (await piket.get('/api/v1/gate/today').set('X-School-Id', school).expect(200)).body as Today;
    expect(body.counts).toMatchObject({ students: 4, arrived: 2, notArrived: 2 });
    expect(body.late.map((l) => l.name)).toContain('BUDI');
    expect(body.notArrived).toEqual([expect.objectContaining({ name: 'CITRA', leave: 'S' }), expect.objectContaining({ name: 'DODI', leave: null })]);
  });

  it('gives the live board per rombel as counts only (GRB-08)', async () => {
    await guru.get('/api/v1/gate/board').set('X-School-Id', school).expect(403);
    const board = (await piket.get('/api/v1/gate/board').set('X-School-Id', school).expect(200)).body as {
      schoolDate: string;
      updatedAt: string;
      totals: { onTime: number; late: number } & Record<string, number>;
      classes: { className: string; students: number; onTime: number; late: number; notArrived: number; excused: number }[];
    };
    expect(board.schoolDate).toBe(today);
    expect(Date.now() - new Date(board.updatedAt).getTime()).toBeLessThan(60_000);
    // BUDI is late, ANI came in by hand (late or on time by the clock), CITRA has an izin, DODI is not in.
    expect(board.totals).toMatchObject({ students: 4, notArrived: 2, excused: 1 });
    expect(board.totals.onTime + board.totals.late).toBe(2);
    expect(board.totals.late).toBeGreaterThanOrEqual(1);
    expect(board.classes).toHaveLength(1);
    expect(board.classes[0]).toMatchObject({ className: '6A', students: 4, notArrived: 2, excused: 1 });
    expect(JSON.stringify(board)).not.toMatch(/BUDI|CITRA|DODI/); // counts only, no names
  });
});
