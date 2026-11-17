import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendanceConsumers, findSchool, generateForSchool } from '../src/modules/attendance';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let wakasek: Agent;
let pembina: Agent;
let guru: Agent;
let wali: Agent;
let parent: Agent;
let students: Record<string, string>;
let pramuka: string;
const key = () => `keg-sesi-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object = {}) => agent.post(`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

/** The next Monday and the Saturday after it (SD: lessons Mon-Fri, Saturday is not a school day). */
const today = schoolDate('Asia/Jakarta');
let monday = addDays(today, 1);
while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
const saturday = addDays(monday, 5);

async function generate(date: string) {
  const row = await withPlatform((tx) => findSchool(tx, school));
  if (!row) throw new Error('no school');
  return generateForSchool(row, date, new Date());
}

async function activitySession(date: string) {
  const s = schema.attendanceSessions;
  const [row] = await getDb()
    .db.select({ id: s.id })
    .from(s)
    .where(and(eq(s.schoolId, school), eq(s.schoolDate, date), eq(s.mode, 'activity')));
  if (!row) return null;
  const records = await getDb()
    .db.select({ enrollmentId: schema.attendanceRecords.enrollmentId, status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(eq(schema.attendanceRecords.sessionId, row.id));
  const byName = Object.fromEntries(Object.entries(students).map(([name, id]) => [name, records.find((r) => r.enrollmentId === id)?.status ?? null]));
  return { id: row.id, records: byName };
}

type Session = { id: string; mode: string; canFill: boolean; owner: { type: string; name: string }; students: { name: string; status: string | null }[] };

beforeAll(async () => {
  school = await t.school('sd', 'SD Ekskul');
  const ids: Record<string, string> = {};
  const agents: Record<string, Agent> = {};
  for (const [label, role] of [
    ['wakasek', 'wakasek'],
    ['pembina', 'guru'],
    ['guru', 'guru'],
    ['wali', 'guru'],
    ['parent', 'orang_tua'],
  ] as const) {
    const u = await t.staff(`Pak ${label}`);
    ids[label] = u.id;
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(agents[label], u.email).expect(200);
  }
  wakasek = agents.wakasek as Agent;
  await enableTotp(wakasek);
  pembina = agents.pembina as Agent;
  guru = agents.guru as Agent;
  wali = agents.wali as Agent;
  parent = agents.parent as Agent;

  students = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '5A', grade: 5, homeroomTeacherId: ids.wali }).returning();
    const rows = await tx.insert(schema.students).values(['RAKA', 'SALSA', 'TONI'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Pak parent', userId: ids.parent }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: rows[0]?.id ?? '', guardianId: guardian?.id ?? '', relation: 'ayah', isPrimary: true });
    return Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
  });

  const created = await post(wakasek, '/activities', { name: 'Pramuka', kind: 'ekskul', location: 'sekolah', days: [1, 6], coachIds: [ids.pembina] }).expect(200);
  pramuka = (created.body as { id: string }).id;
  await pembina
    .put(`/api/v1/activities/${pramuka}/members`)
    .set('X-School-Id', school)
    .set('Idempotency-Key', key())
    .send({ enrollmentIds: [students.RAKA, students.SALSA] })
    .expect(200);
});

describe('activity sessions (KEG-01)', () => {
  it('generates activity sessions on their weekdays, also on a Saturday without lessons, with izin applied', async () => {
    const leave = await post(parent, '/leave-requests', { enrollmentId: students.RAKA, kind: 'sakit', startsOn: monday, endsOn: monday, reason: 'Demam' }).expect(200);
    const leaveId = (leave.body as { id: string }).id;
    await post(wali, `/leave-requests/${leaveId}/decide`, { approve: true }).expect(200);
    const consumer = attendanceConsumers().find((c) => c.event === 'leave.approved');
    await runConsumer(consumer!, { id: uuidv7(), schoolId: school, type: 'leave.approved', payload: { leaveRequestId: leaveId }, traceId: null, occurredAt: new Date().toISOString() });

    expect(await generate(monday)).toEqual({ schoolDate: monday, created: 2 }); // rombel 5A + Pramuka
    expect((await activitySession(monday))?.records).toEqual({ RAKA: 'S', SALSA: null, TONI: null });
    expect(await generate(saturday)).toEqual({ schoolDate: saturday, skipped: 'not_school_day' });
    expect(await activitySession(saturday)).not.toBeNull();
    expect(await activitySession(addDays(monday, 1))).toBeNull(); // Tuesday: no Pramuka
  });

  it('lets the coach open today’s session, once, with the members as roster', async () => {
    const first = (await post(pembina, `/activities/${pramuka}/sessions`).expect(200)).body as Session;
    expect(first).toMatchObject({ mode: 'activity', canFill: true, owner: { type: 'activity', name: 'Pramuka' } });
    expect(first.students.map((s) => s.name)).toEqual(['RAKA', 'SALSA']);
    const again = (await post(pembina, `/activities/${pramuka}/sessions`).expect(200)).body as Session;
    expect(again.id).toBe(first.id);
    const mine = (await get(pembina, `/attendance/today`).expect(200)).body as { sessions: { id: string }[] };
    expect(mine.sessions.map((s) => s.id)).toContain(first.id);

    await post(guru, `/activities/${pramuka}/sessions`).expect(404);
    await post(pembina, `/activities/${pramuka}/sessions`, { date: addDays(today, 1) }).expect(400);
  });

  it('keeps an activity alpa out of the school day: no parent alert, no daily status', async () => {
    const { id } = (await post(pembina, `/activities/${pramuka}/sessions`).expect(200)).body as Session;
    await post(pembina, `/sessions/${id}/submit`, { exceptions: [{ enrollmentId: students.SALSA, status: 'A' }] }).expect(200);
    expect((await activitySession(today))?.records).toEqual({ RAKA: 'H', SALSA: 'A', TONI: null });
    const events = await getDb().db.execute<{ n: number }>(
      sql`select count(*)::int as n from outbox_events where school_id = ${school}::uuid and type = 'attendance.absent_marked' and payload->>'sessionId' = ${id}`,
    );
    expect(events.rows[0]?.n).toBe(0);
    const daily = await getDb().db.select().from(schema.dailyAttendance).where(eq(schema.dailyAttendance.enrollmentId, students.SALSA ?? ''));
    expect(daily).toEqual([]);
  });

  it('gives a recap from the activity’s own sessions', async () => {
    const res = await get(pembina, `/activities/${pramuka}/recap?from=${today}&to=${saturday}`).expect(200);
    const recap = res.body as { sessions: number; items: { name: string; counts: Record<string, number>; presentRate: number | null }[] };
    expect(recap.sessions).toBe(3);
    expect(recap.items).toMatchObject([
      { name: 'RAKA', counts: { H: 1, S: 1, A: 0 }, presentRate: 0.5 },
      { name: 'SALSA', counts: { H: 0, A: 1 }, presentRate: 0 },
    ]);
    await get(guru, `/activities/${pramuka}/recap?from=${today}&to=${saturday}`).expect(404);
  });
});
