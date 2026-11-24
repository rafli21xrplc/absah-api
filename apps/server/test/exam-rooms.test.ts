import { schema } from '@absah/db';
import type { ExamRoom, ExamRoomList, RoomRoster } from '@absah/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let off: string;
let periodId: string;
let closedPeriodId: string;
let classA: string;
let classB: string;
let superId: string;
let parentId: string;
const enroll: Record<string, string> = {};
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const key = () => `rm-${uuidv7()}`;
const url = (path: string) => `/api/v1/exam${path}`;
const get = (agent: Agent, path: string, schoolId = school) => agent.get(url(path)).set('X-School-Id', schoolId);
const send = (method: 'post' | 'patch' | 'delete', agent: Agent, path: string, body: object = {}, schoolId = school) => agent[method](url(path)).set('X-School-Id', schoolId).set('Idempotency-Key', key()).send(body);
const addRoom = (name: string, extra: object = {}, period = periodId, agent = A('wakasek')) => send('post', agent, `/periods/${period}/rooms`, { name, ...extra });
const rooms = async () => (await get(A('kepsek'), `/periods/${periodId}/rooms`).expect(200)).body as ExamRoomList;
const roster = async (roomId: string, agent = A('wakasek')) => (await get(agent, `/rooms/${roomId}/students`).expect(200)).body as RoomRoster;
const seat = (roomId: string, body: object, agent = A('wakasek')) => send('post', agent, `/rooms/${roomId}/students`, body);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Ruang Ujian');
  other = await t.school('smp', 'SMP Ruang Lain');
  off = await t.school('smp', 'SMP Ruang Mati');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'exam.enabled', value: false });
  const roles = { wakasek: 'wakasek', admin: 'admin', kepsek: 'kepsek', pengawas: 'guru', guru: 'guru', wali: 'wali_kelas', ortu: 'orang_tua' } as const;
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Ruang ${name}`);
    if (name === 'pengawas') superId = p.id;
    if (name === 'ortu') parentId = p.id;
    for (const s of [school, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [a, b] = await tx.insert(schema.classes).values([{ schoolId: school, academicYearId: yearId, name: '8A', grade: 8 }, { schoolId: school, academicYearId: yearId, name: '8B', grade: 8 }]).returning();
    classA = a?.id ?? '';
    classB = b?.id ?? '';
    for (const [name, cls, status] of [['Ani', classA, 'active'], ['Budi', classA, 'active'], ['Citra', classA, 'active'], ['Dedi', classB, 'active'], ['Eko', classB, 'active'], ['Pindah', classB, 'moved']] as const) {
      const [st] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      enroll[name] = (await tx.insert(schema.enrollments).values({ schoolId: school, studentId: st?.id ?? '', classId: cls, academicYearId: yearId, startsOn: '2026-07-13', status }).returning())[0]?.id ?? '';
    }
    const [open, closed] = await tx.insert(schema.examPeriods).values([
      { schoolId: school, academicYearId: yearId, name: 'PTS', startsOn: '2099-12-01', endsOn: '2099-12-05' },
      { schoolId: school, academicYearId: yearId, name: 'PAS Lama', startsOn: '2026-06-01', endsOn: '2026-06-05', closedAt: new Date() },
    ]).returning();
    periodId = open?.id ?? '';
    closedPeriodId = closed?.id ?? '';
  });
});

describe('exam rooms (UJN-03)', () => {
  it('are added by the wakasek and the admin, with a capacity and a pengawas from the staff', async () => {
    const made = await addRoom('R1', { capacity: 3, supervisorId: superId }).expect(201);
    expect(made.body).toMatchObject({ name: 'R1', capacity: 3, supervisor: { id: superId }, seated: 0 });
    expect((await addRoom('R2', {}, periodId, A('admin')).expect(201)).body).toMatchObject({ capacity: null, supervisor: null });
    await addRoom('R1').expect(409);
    await addRoom('R3', { supervisorId: parentId }).expect(400); // a parent is not a pengawas
    await addRoom('R3', { supervisorId: uuidv7() }).expect(400);
    await addRoom('R3', { capacity: 0 }).expect(400);
    await addRoom('', {}).expect(400);
    await addRoom('R3', {}, closedPeriodId).expect(409);
    await addRoom('R3', {}, uuidv7()).expect(404);
    for (const name of ['kepsek', 'wali', 'guru', 'ortu']) await addRoom('Curang', {}, periodId, A(name)).expect(403);
    expect((await rooms()).items.map((r) => r.name)).toEqual(['R1', 'R2']);
  });

  it('seat a whole rombel with the lowest free numbers, active students only, and count who has no room', async () => {
    const [r1] = (await rooms()).items;
    const first = await seat(r1?.id ?? '', { classId: classA }).expect(200);
    expect(first.body).toEqual({ added: 3, moved: 0, unchanged: 0, seated: 3 });
    expect((await roster(r1?.id ?? '')).items.map((i) => [i.seatNo, i.student.name, i.className])).toEqual([[1, 'Ani', '8A'], [2, 'Budi', '8A'], [3, 'Citra', '8A']]);
    expect((await rooms()).unseated).toBe(2); // Dedi and Eko; Pindah is not active
    expect((await seat(r1?.id ?? '', { classId: classA }).expect(200)).body).toEqual({ added: 0, moved: 0, unchanged: 3, seated: 3 }); // again changes nothing
  });

  it('refuse more than the capacity without changing anything, and refuse who is not an active student', async () => {
    const [r1] = (await rooms()).items;
    expect((await seat(r1?.id ?? '', { enrollmentIds: [enroll.Dedi] }).expect(409)).body).toMatchObject({ details: { reason: 'room_full' } });
    expect((await roster(r1?.id ?? '')).items).toHaveLength(3);
    await seat(r1?.id ?? '', { enrollmentIds: [enroll.Pindah] }).expect(400);
    await seat(r1?.id ?? '', { enrollmentIds: [uuidv7()] }).expect(400);
    await seat(r1?.id ?? '', { classId: uuidv7() }).expect(400);
    await seat(r1?.id ?? '', {}).expect(400);
    await send('patch', A('wakasek'), `/rooms/${r1?.id}`, { capacity: 2 }).expect(409); // below those already seated
  });

  it('move a student from another room, freeing the old seat, and give the next free number', async () => {
    const [r1, r2] = (await rooms()).items;
    const moved = await seat(r2?.id ?? '', { enrollmentIds: [enroll.Budi, enroll.Dedi, enroll.Eko] }).expect(200);
    expect(moved.body).toEqual({ added: 2, moved: 1, unchanged: 0, seated: 3 });
    expect((await roster(r2?.id ?? '')).items.map((i) => [i.seatNo, i.student.name])).toEqual([[1, 'Budi'], [2, 'Dedi'], [3, 'Eko']]);
    expect((await roster(r1?.id ?? '')).items.map((i) => [i.seatNo, i.student.name])).toEqual([[1, 'Ani'], [3, 'Citra']]); // Budi's number 2 is free again
    expect((await seat(r1?.id ?? '', { enrollmentIds: [enroll.Budi] }).expect(200)).body).toMatchObject({ moved: 1 });
    expect((await roster(r1?.id ?? '')).items.map((i) => [i.seatNo, i.student.name])).toEqual([[1, 'Ani'], [2, 'Budi'], [3, 'Citra']]);
    expect((await rooms()).unseated).toBe(0);
  });

  it('take a student out of a room, and remove a room with its seating', async () => {
    const [r1, r2] = (await rooms()).items;
    await send('delete', A('wakasek'), `/rooms/${r1?.id}/students/${enroll.Ani}`).expect(204);
    await send('delete', A('wakasek'), `/rooms/${r1?.id}/students/${enroll.Ani}`).expect(404);
    expect((await rooms()).unseated).toBe(1);
    await send('delete', A('admin'), `/rooms/${r2?.id}`).expect(204);
    expect((await rooms()).items.map((r) => r.name)).toEqual(['R1']);
    expect((await rooms()).unseated).toBe(3); // Dedi and Eko, whose room went, and Ani
    expect(await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.examSeats).where(eq(schema.examSeats.roomId, r2?.id ?? '')))).toEqual([]);
    await get(A('wakasek'), `/rooms/${r2?.id}/students`).expect(404);
    await send('delete', A('wakasek'), `/rooms/${r2?.id}`).expect(404);
  });

  it('rename and re-assign a room, keeping the name unique within the period', async () => {
    await addRoom('R2').expect(201);
    const [r1, r2] = (await rooms()).items;
    expect((await send('patch', A('wakasek'), `/rooms/${r1?.id}`, { name: 'Lab 1', capacity: 5, supervisorId: null }).expect(200)).body).toMatchObject({ name: 'Lab 1', capacity: 5, supervisor: null });
    await send('patch', A('wakasek'), `/rooms/${r2?.id}`, { name: 'Lab 1' }).expect(409);
    await send('patch', A('wakasek'), `/rooms/${r2?.id}`, {}).expect(400);
    await send('patch', A('wakasek'), `/rooms/${r2?.id}`, { supervisorId: parentId }).expect(400);
    await send('patch', A('kepsek'), `/rooms/${r2?.id}`, { name: 'X' }).expect(403);
    await send('patch', A('wakasek'), `/rooms/${uuidv7()}`, { name: 'X' }).expect(404);
  });

  it('show the seat list only to wakasek, kepsek, admin and the room’s own pengawas', async () => {
    const lab = (await rooms()).items.find((r) => r.name === 'Lab 1');
    const other2 = (await rooms()).items.find((r) => r.name === 'R2');
    await send('patch', A('wakasek'), `/rooms/${other2?.id}`, { supervisorId: superId }).expect(200);
    for (const name of ['wakasek', 'kepsek', 'admin']) await get(A(name), `/rooms/${lab?.id}/students`).expect(200);
    await get(A('pengawas'), `/rooms/${other2?.id}/students`).expect(200); // theirs
    await get(A('pengawas'), `/rooms/${lab?.id}/students`).expect(403); // not theirs
    for (const name of ['guru', 'wali', 'ortu']) await get(A(name), `/rooms/${lab?.id}/students`).expect(403);
  });

  it('stay inside their school and behind the capability', async () => {
    const lab = (await rooms()).items.find((r) => r.name === 'Lab 1');
    await get(A('wakasek'), `/periods/${periodId}/rooms`, off).expect(404);
    await send('post', A('wakasek'), `/periods/${periodId}/rooms`, { name: 'X' }, off).expect(404);
    await get(A('wakasek'), `/rooms/${lab?.id}/students`, other).expect(403); // not a member of that school
    await t.agent().get(url(`/periods/${periodId}/rooms`)).set('X-School-Id', school).expect(401);
  });

  it('are listed to those who read exams, not to a plain guru or a parent', async () => {
    for (const name of ['wakasek', 'kepsek', 'admin', 'wali']) await get(A(name), `/periods/${periodId}/rooms`).expect(200);
    for (const name of ['guru', 'ortu']) await get(A(name), `/periods/${periodId}/rooms`).expect(403);
  });
});

describe('the rooms I supervise (UJN-03)', () => {
  const mineRooms = (agent: Agent, schoolId = school) => agent.get(url('/my-rooms')).set('X-School-Id', schoolId);

  it('lets a pengawas who is a plain guru find their room, with the exam it is for', async () => {
    const { items } = (await mineRooms(A('pengawas')).expect(200)).body as { items: { room: ExamRoom; period: { id: string; name: string; startsOn: string; endsOn: string } }[] };
    expect(items.map((i) => [i.room.name, i.period.name, i.room.seated])).toEqual([['R2', 'PTS', 0]]);
    expect(items[0]?.period).toMatchObject({ id: periodId, startsOn: '2099-12-01', endsOn: '2099-12-05' });
    expect(((await mineRooms(A('guru')).expect(200)).body as { items: unknown[] }).items).toEqual([]); // not anyone's pengawas
  });

  it('leaves out an exam that is closed, and answers staff only, behind the capability', async () => {
    const [room] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.examRooms).values({ schoolId: school, periodId: closedPeriodId, name: 'Lama', supervisorId: superId }).returning());
    expect(room?.name).toBe('Lama');
    expect(((await mineRooms(A('pengawas')).expect(200)).body as { items: unknown[] }).items).toHaveLength(1);
    await mineRooms(A('ortu')).expect(403);
    await mineRooms(A('pengawas'), off).expect(404);
    await t.agent().get(url('/my-rooms')).set('X-School-Id', school).expect(401);
  });
});
