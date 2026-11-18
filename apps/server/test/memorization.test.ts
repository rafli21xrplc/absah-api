import type { MemorizationLog, MemorizationLogList } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let studentId: string;
let other: string;
const agents: Record<'tahfidz' | 'wali' | 'guru' | 'parent', Agent> = {} as never;
const ids: Record<string, string> = {};
const key = () => `hafalan-${uuidv7()}`;
const post = (agent: Agent, body: object, k = key(), s = school) =>
  agent.post('/api/v1/memorization-logs').set('X-School-Id', s).set('Idempotency-Key', k).send(body);
const list = (agent: Agent, id: string) => agent.get(`/api/v1/memorization-logs?studentId=${id}`).set('X-School-Id', school);

beforeAll(async () => {
  school = await t.school('sma', 'MA Tahfidz');
  await getDb().db.update(schema.schools).set({ isMadrasah: true }).where(eq(schema.schools.id, school));
  for (const [label, role] of [
    ['tahfidz', 'guru_tahfidz'],
    ['wali', 'guru'],
    ['guru', 'guru'],
    ['parent', 'orang_tua'],
  ] as const) {
    const u = await t.staff(`Ustadz ${label}`);
    ids[label] = u.id;
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(agents[label], u.email).expect(200);
  }
  ({ studentId, other } = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: 'X IPA 1', grade: 10, homeroomTeacherId: ids.wali }).returning();
    const [a, b] = await tx.insert(schema.students).values([{ schoolId: school, name: 'AHMAD FAUZAN' }, { schoolId: school, name: 'NUR AINI' }]).returning();
    await tx.insert(schema.enrollments).values([a, b].map((s) => ({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })));
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'MUHAMMAD SOLEH', userId: ids.parent }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: a?.id ?? '', guardianId: g?.id ?? '', relation: 'ayah' });
    return { studentId: a?.id ?? '', other: b?.id ?? '' };
  }));
});

describe('setoran hafalan (KEG-03)', () => {
  it('lets the guru tahfidz record a setoran, replayed with the same key', async () => {
    const body = { studentId, surah: 67, juz: 29, ayatFrom: 1, ayatTo: 15, score: 88, note: 'Lancar, perbaiki mad.' };
    const k = key();
    const res = await post(agents.tahfidz, body, k).expect(201);
    expect(res.body as MemorizationLog).toMatchObject({ studentId, surah: 67, surahName: 'Al-Mulk', ayatFrom: 1, ayatTo: 15, score: 88, listener: { id: ids.tahfidz, name: 'Ustadz tahfidz' } });
    const again = await post(agents.tahfidz, body, k).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as MemorizationLog).id).toBe((res.body as MemorizationLog).id);
    await post(agents.tahfidz, { studentId, surah: 112, ayatFrom: 1, ayatTo: 4, date: '2026-09-01' }).expect(201);
  });

  it('refuses ayat beyond the surah, a future date and other staff', async () => {
    await post(agents.tahfidz, { studentId, surah: 67, ayatFrom: 1, ayatTo: 31 }).expect(400);
    await post(agents.tahfidz, { studentId, surah: 1, ayatFrom: 1, ayatTo: 7, date: '2099-01-01' }).expect(400);
    await post(agents.guru, { studentId, surah: 1, ayatFrom: 1, ayatTo: 7 }).expect(403);
    await agents.guru.get('/api/v1/memorization-logs/students?q=ah').set('X-School-Id', school).expect(403);
    const found = await agents.tahfidz.get('/api/v1/memorization-logs/students?q=ahm').set('X-School-Id', school).expect(200);
    expect((found.body as { items: { studentId: string; className: string }[] }).items).toEqual([{ studentId, name: 'AHMAD FAUZAN', className: 'X IPA 1' }]);
  });

  it('shows the history to the parent and wali kelas, newest first, and hides it from others', async () => {
    for (const reader of [agents.parent, agents.wali, agents.tahfidz]) {
      const body = (await list(reader, studentId).expect(200)).body as MemorizationLogList;
      expect(body.items.map((i) => i.surahName)).toEqual(['Al-Mulk', 'Al-Ikhlas']);
      expect(body.canWrite).toBe(reader === agents.tahfidz);
    }
    await list(agents.guru, studentId).expect(404);
    await list(agents.parent, other).expect(404);
  });

  it('is off without religious.memorization', async () => {
    const smp = await t.school('smp', 'SMP tanpa tahfidz');
    await t.member(smp, ids.tahfidz ?? '', 'guru_tahfidz');
    const res = await post(agents.tahfidz, { studentId, surah: 1, ayatFrom: 1, ayatTo: 7 }, key(), smp).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });
});
