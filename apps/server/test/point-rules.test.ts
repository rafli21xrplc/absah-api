import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Rule = { id: string; kind: string; category: string; name: string; points: number; active: boolean };
let school: string;
let otherSchool: string;
let offSchool: string;
let admin: Agent;
let wakasek: Agent;
let guru: Agent;
let wali: Agent;
let petugas: Agent;
let otherAdmin: Agent;
let offAdmin: Agent;
const key = () => `rule-${uuidv7()}`;

const create = (agent: Agent, body: object, schoolId = school, k = key()) => agent.post('/api/v1/point-rules').set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const edit = (agent: Agent, id: string, body: object, schoolId = school) => agent.put(`/api/v1/point-rules/${id}`).set('X-School-Id', schoolId).set('Idempotency-Key', key()).send(body);
/** The rules in a GET answer, typed. */
const rules = (res: { body: unknown }) => (res.body as { items: Rule[] }).items;
const list = (agent: Agent, query = '', schoolId = school) => agent.get(`/api/v1/point-rules${query}`).set('X-School-Id', schoolId);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Poin');
  otherSchool = await t.school('smp', 'SMP Poin Lain');
  offSchool = await t.school('smp', 'SMP Tanpa Poin');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: offSchool, key: 'student.points', value: false });
  const people = {
    admin: await t.staff('Admin Poin'),
    wakasek: await t.staff('Wakasek Kesiswaan'),
    guru: await t.staff('Pak Guru Poin'),
    wali: await t.staff('Bu Wali Poin'),
    petugas: await t.staff('Petugas UKS Poin'),
    otherAdmin: await t.staff('Admin Sekolah Lain'),
    offAdmin: await t.staff('Admin Tanpa Poin'),
  };
  await t.member(school, people.admin.id, 'admin');
  await t.member(school, people.wakasek.id, 'wakasek');
  await t.member(school, people.guru.id, 'guru');
  await t.member(school, people.wali.id, 'wali_kelas');
  await t.member(school, people.petugas.id, 'petugas_uks');
  await t.member(otherSchool, people.otherAdmin.id, 'admin');
  await t.member(offSchool, people.offAdmin.id, 'admin');
  const login = async (email: string, twoFactor = false): Promise<Agent> => {
    const agent = t.agent();
    await signIn(agent, email).expect(200);
    // Admins act in a school only with two-factor on (PLT-01).
    if (twoFactor) await enableTotp(agent);
    return agent;
  };
  admin = await login(people.admin.email, true);
  wakasek = await login(people.wakasek.email);
  guru = await login(people.guru.email);
  wali = await login(people.wali.email);
  petugas = await login(people.petugas.email);
  otherAdmin = await login(people.otherAdmin.email, true);
  offAdmin = await login(people.offAdmin.email, true);
});

describe('POST /point-rules (KSW-01)', () => {
  it('lets admin and wakasek create rules, pelanggaran negative and prestasi positive', async () => {
    const a = await create(admin, { kind: 'violation', category: 'Kedisiplinan', name: 'Terlambat masuk kelas', points: -5 }).expect(201);
    expect(a.body).toMatchObject({ kind: 'violation', category: 'Kedisiplinan', name: 'Terlambat masuk kelas', points: -5, active: true });
    const b = await create(wakasek, { kind: 'achievement', category: 'Akademik', name: 'Juara kelas', points: 20 }).expect(201);
    expect(b.body).toMatchObject({ kind: 'achievement', points: 20 });
  });

  it('refuses points that point the wrong way for the kind, and zero', async () => {
    for (const body of [
      { kind: 'violation', category: 'Kedisiplinan', name: 'Salah tanda', points: 5 },
      { kind: 'achievement', category: 'Akademik', name: 'Salah tanda juga', points: -5 },
      { kind: 'violation', category: 'Kedisiplinan', name: 'Nol', points: 0 },
      { kind: 'violation', category: 'Kedisiplinan', name: 'Terlalu besar', points: -101 },
    ]) {
      await create(admin, body).expect(400);
    }
    expect(rules(await list(admin, '?all=true')).map((r) => r.name)).not.toContain('Salah tanda');
  });

  it('answers 409 for a name that is taken, whatever its case, only within one school', async () => {
    await create(admin, { kind: 'violation', category: 'Kedisiplinan', name: 'TERLAMBAT MASUK KELAS', points: -3 }).expect(409);
    await create(otherAdmin, { kind: 'violation', category: 'Kedisiplinan', name: 'Terlambat masuk kelas', points: -3 }, otherSchool).expect(201);
  });

  it('is idempotent: the same key twice is one rule', async () => {
    const k = key();
    const body = { kind: 'violation', category: 'Ketertiban', name: 'Atribut tidak lengkap', points: -2 };
    const first = await create(admin, body, school, k).expect(201);
    const again = await create(admin, body, school, k).expect(201);
    expect((again.body as Rule).id).toBe((first.body as Rule).id);
    expect(rules(await list(admin)).filter((r) => r.name === 'Atribut tidak lengkap')).toHaveLength(1);
  });

  it('is for admin and wakasek only', async () => {
    for (const agent of [guru, wali, petugas]) {
      await create(agent, { kind: 'violation', category: 'Kedisiplinan', name: 'Tidak boleh', points: -1 }).expect(403);
    }
  });

  it('audits the creation with the rule, never anything about a student', async () => {
    const rows = await getDb()
      .db.select({ after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'ksw.point_rule_created')));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.after)).toContainEqual({ kind: 'violation', category: 'Kedisiplinan', rule: 'Terlambat masuk kelas', points: -5 });
  });
});

describe('GET /point-rules', () => {
  it('shows live rules to admin, kepsek-level readers, wakasek, wali kelas and guru, pelanggaran first', async () => {
    for (const agent of [admin, wakasek, guru, wali]) {
      const res = await list(agent).expect(200);
      const items = rules(res);
      expect(items.length).toBeGreaterThanOrEqual(3);
      const kinds = items.map((r) => r.kind);
      expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === 'violation' ? -1 : 1)));
      expect(items.every((r) => r.active)).toBe(true);
    }
  });

  it('keeps the UKS petugas out and other schools apart', async () => {
    await list(petugas).expect(403);
    const others = rules(await list(otherAdmin, '', otherSchool).expect(200));
    expect(others.map((r) => r.name)).toEqual(['Terlambat masuk kelas']);
  });

  it('answers 404 CAPABILITY_DISABLED when student.points is off', async () => {
    const res = await list(offAdmin, '', offSchool).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
  });
});

describe('PUT /point-rules/{id}', () => {
  let rule: Rule;
  beforeAll(async () => {
    rule = (await create(admin, { kind: 'violation', category: 'Kedisiplinan', name: 'Membolos', points: -15 }).expect(201)).body as Rule;
  });

  it('edits some fields and leaves the rest', async () => {
    const res = await edit(wakasek, rule.id, { points: -20, category: 'Berat' }).expect(200);
    expect(res.body).toMatchObject({ id: rule.id, kind: 'violation', name: 'Membolos', category: 'Berat', points: -20, active: true });
  });

  it('keeps the sign of the kind: a pelanggaran cannot turn positive', async () => {
    await edit(admin, rule.id, { points: 10 }).expect(400);
    const stored = rules(await list(admin)).find((r) => r.id === rule.id);
    expect(stored?.points).toBe(-20);
  });

  it('cannot change the kind, and refuses a name that is taken', async () => {
    await edit(admin, rule.id, { kind: 'achievement' }).expect(400);
    await edit(admin, rule.id, { name: 'Terlambat masuk kelas' }).expect(409);
  });

  it('switches a rule off: hidden for teachers, still there for the managers', async () => {
    await edit(admin, rule.id, { active: false }).expect(200);
    expect(rules(await list(guru)).map((r) => r.id)).not.toContain(rule.id);
    // A teacher asking for all still gets only live rules.
    expect(rules(await list(guru, '?all=true')).map((r) => r.id)).not.toContain(rule.id);
    const all = rules(await list(admin, '?all=true'));
    expect(all.find((r) => r.id === rule.id)).toMatchObject({ active: false });
  });

  it('is for admin and wakasek, and 404 across schools', async () => {
    await edit(guru, rule.id, { active: true }).expect(403);
    await edit(otherAdmin, rule.id, { active: true }, otherSchool).expect(404);
    await edit(admin, uuidv7(), { active: true }).expect(404);
  });

  it('audits what changed with before and after', async () => {
    const rows = await getDb()
      .db.select({ before: schema.auditLogs.before, after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'ksw.point_rule_updated'), eq(schema.auditLogs.entityId, rule.id)));
    expect(rows).toContainEqual({ before: { points: -15, category: 'Kedisiplinan' }, after: { points: -20, category: 'Berat' } });
  });
});

describe('the database', () => {
  it('refuses a rule whose sign disagrees with its kind even without the API', async () => {
    await expect(
      getDb().db.insert(schema.pointRules).values({ schoolId: school, kind: 'violation', category: 'x', name: 'langsung', points: 5 }),
    ).rejects.toThrow();
  });
});
