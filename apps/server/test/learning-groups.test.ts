import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { fixture, importer } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let operatorId: string;
let teacher: string;
const key = () => `group-${uuidv7()}`;

beforeAll(async () => {
  const o = await t.staff('Operator Kelompok');
  operatorId = o.id;
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
  teacher = (await t.staff('Bu Informatika')).id;
});

async function newSchool(level: 'sma' | 'smp') {
  const school = await t.school(level, `${level.toUpperCase()} Kelompok`);
  await t.member(school, operatorId, 'operator');
  await t.member(school, teacher, 'guru');
  return school;
}

type Student = { name: string; enrollment: { id: string } | null };
type Detail = { id: string; memberCount: number; members: { name: string; className: string }[] };

describe('learning groups', () => {
  it('are only for schools with attendance.learningGroups', async () => {
    const smp = await newSchool('smp');
    const res = await operator.get('/api/v1/learning-groups').set('X-School-Id', smp).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });

  it('take members across rombel, unless a member already has a lesson at a group lesson time', async () => {
    const school = await newSchool('sma');
    const as = (req: ReturnType<Agent['get']>) => req.set('X-School-Id', school).set('Idempotency-Key', key());
    const imports = importer(t, operator, school);
    await imports.commit((await imports.prepare(await fixture('daftar-pd-awal.xlsx'))).id).expect(200);

    await as(operator.put('/api/v1/schedule/periods')).send({ days: [{ day: 1, periods: [{ number: 1, startsAt: '07:00', endsAt: '07:45' }] }] }).expect(200);
    const subject = (await as(operator.post('/api/v1/subjects')).send({ name: 'Informatika' }).expect(200)).body as { id: string };
    const classes = ((await operator.get('/api/v1/classes').set('X-School-Id', school).expect(200)).body as { items: { id: string; name: string }[] }).items;
    const viiA = classes.find((c) => c.name === 'VII A')?.id ?? '';
    await as(operator.put('/api/v1/schedule/slots')).send({ ownerType: 'class', ownerId: viiA, day: 1, period: 1, subjectId: subject.id, teacherId: null }).expect(200);

    const created = await as(operator.post('/api/v1/learning-groups')).send({ name: 'Informatika A', subjectId: subject.id, teacherId: teacher }).expect(200);
    const group = created.body as { id: string; teacher: { name: string } };
    expect(group.teacher.name).toBe('Bu Informatika');
    await as(operator.post('/api/v1/learning-groups')).send({ name: 'Informatika A', subjectId: subject.id, teacherId: null }).expect(409);
    await as(operator.put('/api/v1/schedule/slots')).send({ ownerType: 'group', ownerId: group.id, day: 1, period: 1, subjectId: subject.id, teacherId: teacher }).expect(200);

    const students = ((await operator.get('/api/v1/students').query({ limit: '100' }).set('X-School-Id', school).expect(200)).body as { items: Student[] }).items;
    const enrollment = (name: string) => students.find((s) => s.name === name)?.enrollment?.id ?? '';
    const members = (ids: string[]) => as(operator.put(`/api/v1/learning-groups/${group.id}/members`)).send({ enrollmentIds: ids });

    // ADITYA is in VII A, which has a lesson at Monday 1st period: clash.
    const clash = await members([enrollment('ADITYA PRATAMA'), enrollment('HADI SAPUTRA')]).expect(409);
    expect((clash.body as { details: { conflicts: { with: string; students: string[] }[] } }).details.conflicts).toEqual([
      expect.objectContaining({ with: 'VII A', students: ['ADITYA PRATAMA'] }),
    ]);
    const ok = await members([enrollment('HADI SAPUTRA'), enrollment('INDAH PERMATA')]).expect(200);
    expect((ok.body as Detail).members.map((m) => [m.name, m.className])).toEqual([
      ['HADI SAPUTRA', 'VIII A'],
      ['INDAH PERMATA', 'VIII A'],
    ]);
    await members([uuidv7()]).expect(400);

    const list = await operator.get('/api/v1/learning-groups').set('X-School-Id', school).expect(200);
    expect((list.body as { items: Detail[] }).items.map((g) => g.memberCount)).toEqual([2]);
  });
});
