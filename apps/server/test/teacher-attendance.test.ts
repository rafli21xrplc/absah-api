import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());
afterEach(() => vi.useRealTimers());

// Wall-clock instants, all on the school clock of Asia/Jakarta (WIB = UTC+7). 2026-11-23 is a Monday.
const MON_0650 = '2026-11-22T23:50:00Z';
const MON_0720 = '2026-11-23T00:20:00Z';
const MON_0730 = '2026-11-23T00:30:00Z';
const MON_1500 = '2026-11-23T08:00:00Z';
const MON_1600 = '2026-11-23T09:00:00Z';
const TUE_0700 = '2026-11-24T00:00:00Z';
const SUN_1000 = '2026-11-22T03:00:00Z';
/** Pins `Date` only, so the HTTP stack and timers keep running. */
const at = (instant: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
};

let timetable: string; // Monday's first lesson starts 07.30
let plain: string; // no timetable: school starts 07.00, Senin-Jumat
let off: string;
let ids: Record<string, string>;
const agents: Record<string, Agent> = {};
const key = () => `tc-${uuidv7()}`;

const call = (method: 'get' | 'post', agent: Agent, path: string, school: string, k = key()) => {
  const req = method === 'get' ? agent.get(`/api/v1${path}`) : agent.post(`/api/v1${path}`).set('Idempotency-Key', k);
  return req.set('X-School-Id', school);
};
const today = (agent: Agent, school: string) => call('get', agent, '/teacher-attendance/today', school);
const checkIn = (agent: Agent, school: string, k?: string) => call('post', agent, '/teacher-attendance/check-in', school, k).send({});
const checkOut = (agent: Agent, school: string) => call('post', agent, '/teacher-attendance/check-out', school).send({});

beforeAll(async () => {
  timetable = await t.school('smp', 'SMP Guru Jadwal');
  plain = await t.school('smp', 'SMP Guru Tanpa Jadwal');
  off = await t.school('smp', 'SMP Guru Nonaktif');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'teacher.attendance', value: false });
  await withTenant({ schoolId: timetable, userId: null }, (tx) => tx.insert(schema.schedulePeriods).values({ schoolId: timetable, day: 1, number: 1, startsAt: '07:30', endsAt: '08:10' }));
  await withTenant({ schoolId: timetable, userId: null }, (tx) => tx.insert(schema.calendarDays).values({ schoolId: timetable, date: '2026-11-24', kind: 'holiday', name: 'Libur uji' }));
  await withTenant({ schoolId: plain, userId: null }, (tx) => tx.insert(schema.calendarDays).values({ schoolId: plain, date: '2026-11-29', kind: 'school_day', name: 'Ganti hari' }));

  const roles = { guru: 'guru', wali: 'wali_kelas', wakasek: 'wakasek', piket: 'piket', bk: 'guru_bk', tahfidz: 'guru_tahfidz', kepsek: 'kepsek', uks: 'petugas_uks', admin: 'admin', second: 'guru' } as const;
  ids = {};
  for (const [name, role] of Object.entries(roles)) {
    const person = await t.staff(`Presensi ${name}`);
    ids[name] = person.id;
    for (const school of [timetable, plain, off]) await t.member(school, person.id, role);
    const agent = t.agent();
    await signIn(agent, person.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
});

const A = (name: string): Agent => agents[name] as Agent;

describe('GET /teacher-attendance/today (GRU-01)', () => {
  it('shows the school day, the school start and no attendance before the first check-in', async () => {
    at(MON_0650);
    const res = await today(A('guru'), timetable).expect(200);
    expect(res.body).toEqual({ schoolDate: '2026-11-23', schoolDay: true, schoolStart: '07:30', attendance: null });
    expect((await today(A('guru'), plain).expect(200)).body).toMatchObject({ schoolDate: '2026-11-23', schoolStart: '07:00' });
  });

  it('is not a school day on a holiday or a Sunday without an exception', async () => {
    at(TUE_0700);
    expect((await today(A('guru'), timetable).expect(200)).body).toMatchObject({ schoolDay: false });
    at(SUN_1000);
    expect((await today(A('guru'), plain).expect(200)).body).toMatchObject({ schoolDay: false });
  });
});

describe('POST /teacher-attendance/check-in (GRU-01)', () => {
  it('records the first check-in, on time, from the staff app', async () => {
    at(MON_0720);
    const res = await checkIn(A('guru'), timetable).expect(201);
    expect(res.body).toEqual({ schoolDate: '2026-11-23', checkedInAt: '2026-11-23T00:20:00.000Z', checkedOutAt: null, late: false, source: 'app' });
    expect((await today(A('guru'), timetable).expect(200)).body).toMatchObject({ attendance: { late: false } });
  });

  it('compares with the timetable: 07.20 is on time where Monday starts 07.30 and late where school starts 07.00', async () => {
    at(MON_0720);
    expect((await checkIn(A('wali'), timetable).expect(201)).body).toMatchObject({ late: false });
    expect((await checkIn(A('wali'), plain).expect(201)).body).toMatchObject({ late: true });
  });

  it('marks a check-in after the school start as late, and the start minute itself as on time', async () => {
    at(MON_0730);
    expect((await checkIn(A('wakasek'), timetable).expect(201)).body).toMatchObject({ late: false });
    expect((await checkIn(A('piket'), plain).expect(201)).body).toMatchObject({ late: true });
  });

  it('keeps the first check-in when it is sent again, even with another key or a later time', async () => {
    at(MON_0720);
    const first = (await checkIn(A('bk'), timetable).expect(201)).body as { checkedInAt: string };
    at(MON_1500);
    const again = await checkIn(A('bk'), timetable).expect(200);
    expect(again.body).toMatchObject({ checkedInAt: first.checkedInAt, late: false });
    const sameKey = key();
    at(MON_0720);
    const one = await checkIn(A('tahfidz'), timetable, sameKey).expect(201);
    const retry = await checkIn(A('tahfidz'), timetable, sameKey).expect(201);
    expect(retry.body).toEqual(one.body);
  });

  it('refuses a holiday and a Sunday, and accepts a Sunday the calendar made a school day', async () => {
    at(TUE_0700);
    const holiday = await checkIn(A('guru'), timetable).expect(409);
    expect(holiday.body).toMatchObject({ details: { reason: 'not_school_day' } });
    at(SUN_1000);
    await checkIn(A('guru'), plain).expect(409);
    at('2026-11-29T00:00:00Z');
    await checkIn(A('guru'), plain).expect(201);
  });
});

describe('POST /teacher-attendance/check-out (GRU-01)', () => {
  it('needs a check-in the same day', async () => {
    at(MON_1500);
    const res = await checkOut(A('second'), timetable).expect(409);
    expect(res.body).toMatchObject({ details: { reason: 'not_checked_in' } });
  });

  it('records the check-out and lets a later one replace it', async () => {
    at(MON_0720);
    await checkIn(A('second'), timetable).expect(201);
    at(MON_1500);
    expect((await checkOut(A('second'), timetable).expect(200)).body).toMatchObject({ checkedInAt: '2026-11-23T00:20:00.000Z', checkedOutAt: '2026-11-23T08:00:00.000Z', late: false });
    at(MON_1600);
    expect((await checkOut(A('second'), timetable).expect(200)).body).toMatchObject({ checkedOutAt: '2026-11-23T09:00:00.000Z' });
    expect((await today(A('second'), timetable).expect(200)).body).toMatchObject({ attendance: { checkedOutAt: '2026-11-23T09:00:00.000Z' } });
  });

  it("never touches another teacher's row", async () => {
    at(MON_1500);
    await checkOut(A('guru'), timetable).expect(200);
    expect((await today(A('wakasek'), timetable).expect(200)).body).toMatchObject({ attendance: { checkedOutAt: null } });
  });
});

describe('who may check in (GRU-01)', () => {
  it('lets the roles that teach, and refuses everyone else', async () => {
    at(MON_0720);
    for (const name of ['guru', 'wali', 'wakasek', 'piket', 'bk', 'tahfidz']) await today(A(name), timetable).expect(200);
    for (const name of ['kepsek', 'uks', 'admin']) {
      await today(A(name), timetable).expect(403);
      await checkIn(A(name), timetable).expect(403);
      await checkOut(A(name), timetable).expect(403);
    }
  });

  it('is off when the school switched teacher.attendance off, and needs a login', async () => {
    at(MON_0720);
    await today(A('guru'), off).expect(404);
    await checkIn(A('guru'), off).expect(404);
    await t.agent().get('/api/v1/teacher-attendance/today').set('X-School-Id', timetable).expect(401);
  });
});
