import type { DudiPartner, DudiPartnerList, PklStaffList, PklStudentList } from '@absah/contracts';
import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let enrollmentId: string;
const agents: Record<'humas' | 'kepsek' | 'guru', Agent> = {} as never;
const ids: Record<string, string> = {};
const key = () => `pkl-${uuidv7()}`;
const HOURS = [1, 2, 3, 4, 5].map((day) => ({ day, startsAt: '08:00', endsAt: '16:00' }));
const body = (name: string) => ({ name, address: 'Jl. Industri No. 1, Bekasi', latitude: -6.2383, longitude: 106.9756, workHours: HOURS });
const create = (agent: Agent, b: object, k = key(), s = school) => agent.post('/api/v1/pkl/partners').set('X-School-Id', s).set('Idempotency-Key', k).send(b);

beforeAll(async () => {
  school = await t.school('smk', 'SMK Absah Uji PKL');
  for (const [label, role] of [
    ['humas', 'humas_pkl'],
    ['kepsek', 'kepsek'],
    ['guru', 'guru'],
  ] as const) {
    const u = await t.staff(`Bapak ${label}`);
    ids[label] = u.id;
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(agents[label], u.email).expect(200);
  }
  const industri = await t.staff('Pak Mandor');
  await t.member(school, industri.id, 'pembimbing_industri');
  enrollmentId = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: 'XI TKJ 1', grade: 11 }).returning();
    const [s] = await tx.insert(schema.students).values({ schoolId: school, name: 'RIZKY PRATAMA', nisn: '0091234567' }).returning();
    const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
    return e?.id ?? '';
  });
});

describe('DUDI partners (PKL-01)', () => {
  let partner: DudiPartner;

  it('lets humas PKL add a partner with a default radius, replayed with the same key', async () => {
    const k = key();
    const res = await create(agents.humas, body('PT Maju Jaya'), k).expect(201);
    partner = res.body as DudiPartner;
    expect(partner).toMatchObject({ name: 'PT Maju Jaya', radiusM: 150, active: true, activePlacements: 0, workHours: HOURS });
    const again = await create(agents.humas, body('PT Maju Jaya'), k).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as DudiPartner).id).toBe(partner.id);
  });

  it('refuses a taken name, bad hours and doubled days', async () => {
    const dup = await create(agents.humas, body('PT Maju Jaya')).expect(409);
    expect((dup.body as { message: string }).message).toBe('Nama DUDI sudah dipakai.');
    await create(agents.humas, { ...body('CV Satu'), workHours: [{ day: 1, startsAt: '16:00', endsAt: '08:00' }] }).expect(400);
    await create(agents.humas, { ...body('CV Dua'), workHours: [HOURS[0], HOURS[0]] }).expect(400);
    await create(agents.humas, { ...body('CV Tiga'), workHours: [] }).expect(400);
    await create(agents.humas, { ...body('CV Empat'), radiusM: 10 }).expect(400);
  });

  it('edits fields and replaces the working days', async () => {
    const saturday = [...HOURS, { day: 6, startsAt: '08:00', endsAt: '12:00' }];
    const res = await agents.humas
      .patch(`/api/v1/pkl/partners/${partner.id}`)
      .set('X-School-Id', school)
      .set('Idempotency-Key', key())
      .send({ radiusM: 300, workHours: saturday })
      .expect(200);
    expect(res.body as DudiPartner).toMatchObject({ radiusM: 300, workHours: saturday });
    await agents.humas.patch(`/api/v1/pkl/partners/${uuidv7()}`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ active: false }).expect(404);
  });

  it('lets the kepsek read but not write; other staff neither', async () => {
    const list = (await agents.kepsek.get('/api/v1/pkl/partners').set('X-School-Id', school).expect(200)).body as DudiPartnerList;
    expect(list.items.map((p) => p.name)).toEqual(['PT Maju Jaya']);
    await create(agents.kepsek, body('PT Lain')).expect(403);
    await agents.guru.get('/api/v1/pkl/partners').set('X-School-Id', school).expect(403);
    await create(agents.guru, body('PT Lain')).expect(403);
  });

  it('finds students by name or NISN and lists school staff without industry supervisors', async () => {
    for (const q of ['rizky', '00912']) {
      const found = (await agents.humas.get(`/api/v1/pkl/students?q=${q}`).set('X-School-Id', school).expect(200)).body as PklStudentList;
      expect(found.items).toEqual([expect.objectContaining({ enrollmentId, name: 'RIZKY PRATAMA', nisn: '0091234567', className: 'XI TKJ 1' })]);
    }
    await agents.humas.get('/api/v1/pkl/students?q=r').set('X-School-Id', school).expect(400);
    const staff = (await agents.humas.get('/api/v1/pkl/school-mentors').set('X-School-Id', school).expect(200)).body as PklStaffList;
    expect(staff.items.map((s) => s.name)).toEqual(['Bapak guru', 'Bapak humas', 'Bapak kepsek']);
  });

  it('is off without pkl.enabled', async () => {
    const sma = await t.school('sma', 'SMA tanpa PKL');
    await t.member(sma, ids.humas ?? '', 'humas_pkl');
    const res = await create(agents.humas, body('PT Maju Jaya'), key(), sma).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });
});
