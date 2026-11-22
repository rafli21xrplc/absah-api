import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Period = {
  id: string;
  name: string;
  academicYear: { id: string; name: string };
  startsOn: string;
  endsOn: string;
  minAttendance: number | null;
  attendanceFrom: string | null;
  excusedCounts: boolean;
  requirePaid: boolean;
  feeTypeIds: string[];
  closed: boolean;
};

let school: string;
let noYear: string;
let off: string;
let spp: string;
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const key = () => `ujn-${uuidv7()}`;
const get = (agent: Agent, path: string, schoolId = school) => agent.get(`/api/v1/exam${path}`).set('X-School-Id', schoolId);
const post = (agent: Agent, path: string, body: object, schoolId = school) => agent.post(`/api/v1/exam${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', key()).send(body);
const patch = (agent: Agent, id: string, body: object) => agent.patch(`/api/v1/exam/periods/${id}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const create = (body: object, agent = A('wakasek'), schoolId = school) => post(agent, '/periods', { name: 'PTS Ganjil', startsOn: '2026-12-01', endsOn: '2026-12-05', ...body }, schoolId);
const list = async (query = '') => ((await get(A('kepsek'), `/periods${query}`).expect(200)).body as { items: Period[] }).items;

beforeAll(async () => {
  school = await t.school('smp', 'SMP Ujian');
  noYear = await t.school('smp', 'SMP Ujian Tanpa Tahun');
  off = await t.school('smp', 'SMP Ujian Mati');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'exam.enabled', value: false });
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true });
    const [fee] = await tx.insert(schema.feeTypes).values({ schoolId: school, name: 'SPP', kind: 'spp', defaultAmount: 250_000 }).returning();
    spp = fee?.id ?? '';
  });
  const roles = { wakasek: 'wakasek', admin: 'admin', kepsek: 'kepsek', wali: 'wali_kelas', guru: 'guru', bendahara: 'bendahara', ortu: 'orang_tua' } as const;
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Ujian ${name}`);
    for (const s of [school, noYear, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
});

describe('exam periods (UJN-01, UJN-02)', () => {
  it('are made by the wakasek and the admin in the active academic year, with the school’s own rule', async () => {
    const made = await create({ minAttendance: 75, attendanceFrom: '2026-07-13', requirePaid: true, feeTypeIds: [spp] }).expect(201);
    expect(made.body).toMatchObject({ name: 'PTS Ganjil', academicYear: { name: '2026/2027' }, startsOn: '2026-12-01', endsOn: '2026-12-05', minAttendance: 75, attendanceFrom: '2026-07-13', excusedCounts: true, requirePaid: true, feeTypeIds: [spp], closed: false });
    const plain = await create({ name: 'PAS', startsOn: '2026-12-14', endsOn: '2026-12-14' }, A('admin')).expect(201);
    expect(plain.body).toMatchObject({ minAttendance: null, attendanceFrom: null, excusedCounts: true, requirePaid: false, feeTypeIds: [] });
  });

  it('are read by kepsek, wakasek, admin and the wali kelas, and by nobody else', async () => {
    for (const name of ['kepsek', 'wakasek', 'admin', 'wali']) expect(((await get(A(name), '/periods').expect(200)).body as { items: Period[] }).items.map((p) => p.name)).toEqual(['PAS', 'PTS Ganjil']);
    for (const name of ['guru', 'bendahara', 'ortu']) await get(A(name), '/periods').expect(403);
    for (const name of ['kepsek', 'wali', 'guru', 'bendahara', 'ortu']) await create({ name: 'Curang' }, A(name)).expect(403);
  });

  it('keep their names unique within the academic year, ignoring nothing', async () => {
    expect((await create({}).expect(409)).body).toMatchObject({ details: { reason: 'name_taken' } });
    const [pas] = (await list()).filter((p) => p.name === 'PAS');
    await patch(A('wakasek'), pas?.id ?? '', { name: 'PTS Ganjil' }).expect(409);
  });

  it('refuse a bad rule', async () => {
    await create({ name: 'a', endsOn: '2026-12-05' }).expect(400); // name too short
    await create({ name: 'Mundur', endsOn: '2026-11-30' }).expect(400);
    await create({ name: 'Persen', minAttendance: 0 }).expect(400);
    await create({ name: 'Persen', minAttendance: 101 }).expect(400);
    await create({ name: 'Mulai', attendanceFrom: '2026-12-02' }).expect(400); // counting starts after the exam does
    await create({ name: 'Jenis', feeTypeIds: [spp] }).expect(400); // fee types without the paid rule
    await create({ name: 'Jenis', requirePaid: true, feeTypeIds: [uuidv7()] }).expect(400); // not a fee type of the school
    await create({ name: 'Jenis', requirePaid: true, feeTypeIds: [spp, spp] }).expect(400);
    await create({ name: 'Tanggal', startsOn: '1 Desember' }).expect(400);
    expect((await list()).map((p) => p.name)).toEqual(['PAS', 'PTS Ganjil']);
  });

  it('are edited, and closed and reopened without being deleted', async () => {
    const [pts] = (await list()).filter((p) => p.name === 'PTS Ganjil');
    const edited = await patch(A('wakasek'), pts?.id ?? '', { minAttendance: 80, excusedCounts: false, endsOn: '2026-12-06' }).expect(200);
    expect(edited.body).toMatchObject({ minAttendance: 80, excusedCounts: false, endsOn: '2026-12-06', requirePaid: true });
    expect((await patch(A('wakasek'), pts?.id ?? '', { minAttendance: null }).expect(200)).body).toMatchObject({ minAttendance: null });
    expect((await patch(A('wakasek'), pts?.id ?? '', { requirePaid: false }).expect(400)).body).toBeDefined(); // fee types are still listed
    await patch(A('wakasek'), pts?.id ?? '', { requirePaid: false, feeTypeIds: [] }).expect(200);
    await patch(A('wakasek'), pts?.id ?? '', { endsOn: '2026-11-01' }).expect(400);
    await patch(A('wakasek'), pts?.id ?? '', {}).expect(400);
    await patch(A('kepsek'), pts?.id ?? '', { minAttendance: 1 }).expect(403);
    await patch(A('wakasek'), uuidv7(), { minAttendance: 1 }).expect(404);

    expect((await patch(A('admin'), pts?.id ?? '', { closed: true }).expect(200)).body).toMatchObject({ closed: true });
    expect((await list()).map((p) => p.name)).toEqual(['PAS']);
    expect((await list('?includeClosed=true')).map((p) => p.name)).toEqual(['PAS', 'PTS Ganjil']);
    expect((await patch(A('admin'), pts?.id ?? '', { closed: false }).expect(200)).body).toMatchObject({ closed: false });
    expect((await list()).map((p) => p.name)).toEqual(['PAS', 'PTS Ganjil']);
  });

  it('need an active academic year, stay inside their school and behind the capability', async () => {
    expect((await create({}, A('wakasek'), noYear).expect(409)).body).toMatchObject({ details: { reason: 'no_active_year' } });
    await get(A('wakasek'), '/periods', off).expect(404);
    await create({}, A('wakasek'), off).expect(404);
    await t.agent().get('/api/v1/exam/periods').set('X-School-Id', school).expect(401);
    const rows = await withTenant({ schoolId: noYear, userId: null }, (tx) => tx.select().from(schema.examPeriods));
    expect(rows).toEqual([]);
  });

  it('write the rule to the audit log, with the title under "period"', async () => {
    const logs = await getDb().db.select().from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school));
    const created = logs.find((l) => l.action === 'exam.period_created' && (l.after as { period?: string }).period === 'PTS Ganjil');
    expect(created?.after).toMatchObject({ minAttendance: 75, requirePaid: true });
    expect(logs.some((l) => l.action === 'exam.period_updated' && (l.after as { closed?: boolean }).closed === true)).toBe(true);
  });
});
