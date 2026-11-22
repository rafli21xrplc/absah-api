import { randomBytes } from 'node:crypto';
import { schema, sensitive } from '@absah/db';
import type { ExamCheckIn, RoomAttendance } from '@absah/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { bindCards, tokenMaker } from './gate-fixtures';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let school: string;
let periodId: string;
let pastPeriodId: string;
let r1: string;
let r2: string;
let makeToken: Awaited<ReturnType<typeof tokenMaker>>;
const enroll: Record<string, string> = {};
const student: Record<string, string> = {};
const cards = new Map<string, { cardId: string; deviceId: string }>();
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const key = () => `ab-${uuidv7()}`;
const url = (path: string) => `/api/v1/exam${path}`;
const get = (agent: Agent, path: string) => agent.get(url(path)).set('X-School-Id', school);
const post = (agent: Agent, path: string, body: object) => agent.post(url(path)).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const tick = (room: string, name: string, agent = A('pengawas')) => post(agent, `/rooms/${room}/attendance`, { enrollmentId: enroll[name] });
const scan = (room: string, token: string, agent = A('pengawas')) => post(agent, `/rooms/${room}/scan`, { token });
const tokenOf = (name: string, ms = Date.now()) => makeToken(cards.get(student[name] ?? '') ?? { cardId: '', deviceId: '' }, today, ms);
const reason = (res: { body: { details?: { reason?: string } } }) => res.body.details?.reason;
const cardWhy = (res: { body: { details?: { reason?: string; cardReason?: string } } }) => (res.body.details?.reason === 'card_rejected' ? res.body.details.cardReason : res.body.details?.reason);
const list = async (room: string, agent = A('wakasek')) => (await get(agent, `/rooms/${room}/attendance`).expect(200)).body as RoomAttendance;
const rows = () => withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.examAttendance));

const days = (enrollmentId: string, status: 'H' | 'A', n: number) => Array.from({ length: n }, (_, i) => ({ schoolId: school, enrollmentId, schoolDate: `2026-09-${String(i + 1).padStart(2, '0')}`, status }));

beforeAll(async () => {
  school = await t.school('smp', 'SMP Absen Ujian');
  const roles = { wakasek: 'wakasek', admin: 'admin', kepsek: 'kepsek', pengawas: 'guru', guru: 'guru', ortu: 'orang_tua' } as const;
  const ids: Record<string, string> = {};
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Absen ${name}`);
    ids[name] = p.id;
    await t.member(school, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2020-01-01', endsOn: '2099-12-31', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: yearId, name: '8A', grade: 8 }).returning();
    for (const name of ['Ani', 'Budi', 'Citra', 'Dedi', 'Eko']) {
      const [st] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      student[name] = st?.id ?? '';
      enroll[name] = (await tx.insert(schema.enrollments).values({ schoolId: school, studentId: st?.id ?? '', classId: cls?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' }).returning())[0]?.id ?? '';
    }
    await tx.insert(schema.dailyAttendance).values([...['Ani', 'Budi', 'Citra', 'Eko'].flatMap((n) => days(enroll[n] ?? '', 'H', 10)), ...days(enroll.Dedi ?? '', 'A', 10)]);
    const [now, past] = await tx.insert(schema.examPeriods).values([
      { schoolId: school, academicYearId: yearId, name: 'PTS Hari Ini', startsOn: today, endsOn: today, minAttendance: 75 },
      { schoolId: school, academicYearId: yearId, name: 'PTS Kemarin', startsOn: '2026-10-01', endsOn: '2026-10-02' },
    ]).returning();
    periodId = now?.id ?? '';
    pastPeriodId = past?.id ?? '';
    const rooms = await tx.insert(schema.examRooms).values([{ schoolId: school, periodId, name: 'R1', supervisorId: ids.pengawas }, { schoolId: school, periodId, name: 'R2' }]).returning();
    r1 = rooms.find((r) => r.name === 'R1')?.id ?? '';
    r2 = rooms.find((r) => r.name === 'R2')?.id ?? '';
    const seat = (room: string, name: string, no: number) => ({ schoolId: school, periodId, roomId: room, enrollmentId: enroll[name] ?? '', seatNo: no });
    await tx.insert(schema.examSeats).values([seat(r1, 'Ani', 1), seat(r1, 'Budi', 2), seat(r1, 'Dedi', 3), seat(r2, 'Citra', 1)]); // Eko has no seat
  });
  for (const [id, card] of await bindCards(school, Object.values(student))) cards.set(id, card);
  await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.gateSecrets).values({ schoolId: school, secret: sensitive(randomBytes(32).toString('base64url')) }));
  makeToken = await tokenMaker(school);
});

describe('exam attendance by hand (UJN-03)', () => {
  it('records an arrival once, by the room’s pengawas, and answers a second try with the first', async () => {
    const first = await tick(r1, 'Ani').expect(201);
    expect(first.body).toMatchObject({ student: { name: 'Ani' }, seatNo: 1, method: 'manual', duplicate: false });
    const again = await tick(r1, 'Ani').expect(200);
    expect(again.body).toMatchObject({ duplicate: true, checkedInAt: (first.body as ExamCheckIn).checkedInAt });
    expect(await rows()).toHaveLength(1);
  });

  it('turns away a student who may not sit yet, one in another room, and one with no seat', async () => {
    const dedi = await tick(r1, 'Dedi').expect(409);
    expect(dedi.body).toMatchObject({ details: { reason: 'not_eligible', reasons: ['attendance'] } });
    expect((await tick(r1, 'Citra').expect(409)).body).toMatchObject({ details: { reason: 'wrong_room', room: 'R2' } });
    expect(reason(await tick(r1, 'Eko').expect(409))).toBe('not_seated');
    await post(A('pengawas'), `/rooms/${r1}/attendance`, { enrollmentId: uuidv7() }).expect(409);
    expect(await rows()).toHaveLength(1);
  });

  it('follows the rule as it is today: once the school drops the attendance minimum, the student may come in', async () => {
    await A('wakasek').patch(url(`/periods/${periodId}`)).set('X-School-Id', school).set('Idempotency-Key', key()).send({ minAttendance: null }).expect(200);
    await tick(r1, 'Dedi').expect(201);
    await A('wakasek').patch(url(`/periods/${periodId}`)).set('X-School-Id', school).set('Idempotency-Key', key()).send({ minAttendance: 75 }).expect(200);
    expect(await rows()).toHaveLength(2);
  });

  it('only on an exam day of an open period', async () => {
    const [past] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.examRooms).values({ schoolId: school, periodId: pastPeriodId, name: 'Lama', supervisorId: null }).returning());
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.examSeats).values({ schoolId: school, periodId: pastPeriodId, roomId: past?.id ?? '', enrollmentId: enroll.Eko ?? '', seatNo: 1 }));
    expect(reason(await tick(past?.id ?? '', 'Eko', A('wakasek')).expect(409))).toBe('not_exam_day');
    await A('wakasek').patch(url(`/periods/${pastPeriodId}`)).set('X-School-Id', school).set('Idempotency-Key', key()).send({ closed: true }).expect(200);
    expect(reason(await tick(past?.id ?? '', 'Eko', A('wakasek')).expect(409))).toBe('period_closed');
  });

  it('is for the wakasek, the admin and the room’s own pengawas only', async () => {
    await tick(r1, 'Budi', A('guru')).expect(403); // a guru who is not this room's pengawas
    await tick(r1, 'Budi', A('kepsek')).expect(403); // kepsek reads, never records
    await tick(r1, 'Budi', A('ortu')).expect(403);
    await tick(r2, 'Citra', A('pengawas')).expect(403); // another room
    await tick(r1, 'Budi', A('admin')).expect(201);
    await t.agent().post(url(`/rooms/${r1}/attendance`)).set('X-School-Id', school).send({ enrollmentId: enroll.Ani }).expect(401);
  });
});

describe('exam attendance by card QR (UJN-03)', () => {
  it('accepts the same dynamic QR as the daily card, once', async () => {
    const ok = await scan(r2, await tokenOf('Citra'), A('wakasek')).expect(201);
    expect(ok.body).toMatchObject({ student: { name: 'Citra' }, seatNo: 1, method: 'qr', duplicate: false });
    expect((await scan(r2, await tokenOf('Citra'), A('wakasek')).expect(200)).body).toMatchObject({ duplicate: true });
    expect((await rows()).find((r) => r.enrollmentId === enroll.Citra)).toMatchObject({ method: 'qr', roomId: r2 });
  });

  it('rejects a card that does not check out, saying why', async () => {
    expect(cardWhy(await scan(r1, 'garbage').expect(409))).toBe('malformed');
    expect(cardWhy(await scan(r1, await tokenOf('Eko', Date.now() - 10 * 60_000)).expect(409))).toBe('expired');
    // A phone that is not the card's bound one: the signature is right for that phone, but the card belongs to another.
    const card = cards.get(student.Eko ?? '');
    const other = await makeToken({ cardId: card?.cardId ?? '', deviceId: uuidv7() }, today, Date.now());
    expect(cardWhy(await scan(r1, other).expect(409))).toBe('wrong_device');
    expect(cardWhy(await scan(r1, await makeToken({ cardId: uuidv7(), deviceId: uuidv7() }, today, Date.now())).expect(409))).toBe('unknown_card');
  });

  it('sends a card to the right room, and holds back a student who may not sit', async () => {
    expect((await scan(r1, await tokenOf('Dedi')).expect(409)).body).toMatchObject({ details: { reason: 'not_eligible' } });
    expect((await scan(r1, await tokenOf('Ani')).expect(200)).body).toMatchObject({ duplicate: true }); // came by hand earlier
    const wrongRoom = await post(A('wakasek'), `/rooms/${r1}/scan`, { token: await tokenOf('Citra') }).expect(409);
    expect(wrongRoom.body).toMatchObject({ details: { reason: 'wrong_room', room: 'R2' } });
  });
});

describe('the attendance list of a room (UJN-03)', () => {
  it('shows who has arrived, who has not, and who may not sit', async () => {
    const r = await list(r1);
    expect(r.room.name).toBe('R1');
    expect(r.counts).toEqual({ seated: 3, present: 3, absent: 0 }); // Ani and Budi, and Dedi who came while the minimum was off
    expect(r.items.map((i) => [i.seatNo, i.student.name, i.present, i.method, i.eligible])).toEqual([[1, 'Ani', true, 'manual', true], [2, 'Budi', true, 'manual', true], [3, 'Dedi', true, 'manual', false]]);
    expect((await list(r2)).counts).toEqual({ seated: 1, present: 1, absent: 0 });
  });

  it('is read by wakasek, kepsek, admin and the room’s own pengawas, no one else', async () => {
    for (const name of ['wakasek', 'kepsek', 'admin', 'pengawas']) await get(A(name), `/rooms/${r1}/attendance`).expect(200);
    for (const name of ['guru', 'ortu']) await get(A(name), `/rooms/${r1}/attendance`).expect(403);
    await get(A('pengawas'), `/rooms/${r2}/attendance`).expect(403);
    await get(A('wakasek'), `/rooms/${uuidv7()}/attendance`).expect(404);
  });
});

describe('what an arrival protects (UJN-03)', () => {
  it('keeps the room, the seat and the student in place once someone has been checked in', async () => {
    const del = await A('wakasek').delete(url(`/rooms/${r1}`)).set('X-School-Id', school).set('Idempotency-Key', key()).expect(409);
    expect(reason(del)).toBe('room_has_attendance');
    const out = await A('wakasek').delete(url(`/rooms/${r1}/students/${enroll.Ani}`)).set('X-School-Id', school).set('Idempotency-Key', key()).expect(409);
    expect(reason(out)).toBe('checked_in');
    const move = await post(A('wakasek'), `/rooms/${r2}/students`, { enrollmentIds: [enroll.Ani] }).expect(409);
    expect(reason(move)).toBe('checked_in');
    expect((await list(r1)).counts.seated).toBe(3);
  });

  it('is written to the audit log, by method', async () => {
    const logs = await getDb().db.select().from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school));
    const arrivals = logs.filter((l) => l.action === 'exam.checked_in').map((l) => (l.after as { method: string }).method);
    expect(arrivals.filter((m) => m === 'qr')).toHaveLength(1);
    expect(arrivals.filter((m) => m === 'manual')).toHaveLength(3);
  });
});
