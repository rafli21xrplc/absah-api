import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Tier = { id: string; minPoints: number; label: string; action: string; notifyParents: boolean; active: boolean };
type Task = { id: string; student: { enrollmentId: string; name: string; className: string }; label: string; action: string; minPoints: number; totalPoints: number; status: string; completedBy: { name: string } | null; note: string | null };

let school: string;
let otherSchool: string;
let offSchool: string;
let admin: Agent;
let wakasek: Agent;
let kepsek: Agent;
let guru: Agent;
let guruBk: Agent;
let wali: Agent;
let otherWali: Agent;
let otherAdmin: Agent;
let offAdmin: Agent;
let students: Record<string, string>;
let rules: Record<string, string>;
let tiers: Record<string, Tier>;
const key = () => `fu-${uuidv7()}`;

const post = (agent: Agent, path: string, body: object, schoolId = school, k = key()) => agent.post(`/api/v1${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const put = (agent: Agent, path: string, body: object, schoolId = school) => agent.put(`/api/v1${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', key()).send(body);
const get = (agent: Agent, path: string, schoolId = school) => agent.get(`/api/v1${path}`).set('X-School-Id', schoolId);
const tierList = (res: { body: unknown }) => (res.body as { items: Tier[] }).items;
const taskList = (res: { body: unknown }) => (res.body as { items: Task[] }).items;
const violate = (agent: Agent, student: string, rule: string) => post(agent, '/point-entries', { enrollmentId: students[student], ruleId: rules[rule] }).expect(201);
const tasksOf = async (student: string) => taskList(await get(admin, '/followup-tasks').expect(200)).filter((x) => x.student.name === student);
const events = async (taskIds: string[]) => {
  const rows = await getDb().db.select({ payload: schema.outboxEvents.payload }).from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'ksw.threshold_reached')));
  return rows.filter((r) => taskIds.includes((r.payload as { taskId: string }).taskId));
};

async function seedStudents(schoolId: string, className: string, homeroom: string | null, names: string[]) {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [existing] = await tx.select({ id: schema.academicYears.id }).from(schema.academicYears).limit(1);
    const yearId =
      existing?.id ?? (await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning())[0]?.id ?? '';
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: yearId, name: className, grade: 8, homeroomTeacherId: homeroom }).returning();
    const rows = await tx.insert(schema.students).values(names.map((name) => ({ schoolId, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId, studentId: s.id, classId: cls?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' })))
      .returning();
    return Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
  });
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Tindak Lanjut');
  otherSchool = await t.school('smp', 'SMP Lain Tindak');
  offSchool = await t.school('smp', 'SMP Tanpa Poin');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: offSchool, key: 'student.points', value: false });
  const people = {
    admin: await t.staff('Admin Tindak'),
    wakasek: await t.staff('Wakasek Tindak'),
    kepsek: await t.staff('Kepsek Tindak'),
    guru: await t.staff('Pak Guru Tindak'),
    guruBk: await t.staff('Bu BK Tindak'),
    wali: await t.staff('Bu Wali 8B'),
    otherWali: await t.staff('Bu Wali 8C'),
    otherAdmin: await t.staff('Admin Lain'),
    offAdmin: await t.staff('Admin Tanpa Poin'),
  };
  await t.member(school, people.admin.id, 'admin');
  await t.member(school, people.wakasek.id, 'wakasek');
  await t.member(school, people.kepsek.id, 'kepsek');
  await t.member(school, people.guru.id, 'guru');
  await t.member(school, people.guruBk.id, 'guru_bk');
  await t.member(school, people.wali.id, 'wali_kelas');
  await t.member(school, people.otherWali.id, 'wali_kelas');
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
  kepsek = await login(people.kepsek.email);
  guru = await login(people.guru.email);
  guruBk = await login(people.guruBk.email);
  wali = await login(people.wali.email);
  otherWali = await login(people.otherWali.email);
  otherAdmin = await login(people.otherAdmin.email, true);
  offAdmin = await login(people.offAdmin.email, true);

  students = {
    ...(await seedStudents(school, '8B', people.wali.id, ['ANI BERTINGKAT', 'BUDI BERSAMAAN', 'CICI SUSULAN', 'DINA PRESTASI'])),
    ...(await seedStudents(school, '8C', people.otherWali.id, ['EKO KELAS C'])),
  };
  const mk = async (body: object) => ((await post(wakasek, '/point-rules', body).expect(201)).body as { id: string }).id;
  rules = {
    late: await mk({ kind: 'violation', category: 'Kedisiplinan', name: 'Terlambat', points: -5 }),
    small: await mk({ kind: 'violation', category: 'Kedisiplinan', name: 'Atribut', points: -1 }),
    fight: await mk({ kind: 'violation', category: 'Ketertiban', name: 'Berkelahi', points: -50 }),
    champion: await mk({ kind: 'achievement', category: 'Akademik', name: 'Juara', points: 100 }),
  };
});

describe('point thresholds (KSW-03)', () => {
  it('lets admin and wakasek create tiers and rejects bad ones', async () => {
    const a = await post(wakasek, '/point-thresholds', { minPoints: 10, label: 'Peringatan 1', action: 'Panggil orang tua', notifyParents: true }).expect(201);
    expect(a.body).toMatchObject({ minPoints: 10, label: 'Peringatan 1', action: 'Panggil orang tua', notifyParents: true, active: true });
    const b = await post(admin, '/point-thresholds', { minPoints: 25, label: 'Peringatan 2', action: 'Konseling BK', notifyParents: false }).expect(201);
    tiers = { t10: a.body as Tier, t25: b.body as Tier };
    for (const body of [
      { minPoints: 0, label: 'Nol', action: 'Tidak ada', notifyParents: true },
      { minPoints: 1001, label: 'Besar', action: 'Tidak ada', notifyParents: true },
      { minPoints: 30, label: 'x', action: 'Tindakan', notifyParents: true },
      { minPoints: 30, label: 'Tanpa tindakan', notifyParents: true },
      { minPoints: 30, label: 'Lebih', action: 'Tindakan', notifyParents: true, active: false },
    ]) {
      await post(wakasek, '/point-thresholds', body).expect(400);
    }
  });

  it('refuses a second tier with the same points', async () => {
    await post(wakasek, '/point-thresholds', { minPoints: 10, label: 'Kembar', action: 'Tindakan', notifyParents: true }).expect(409);
  });

  it('is idempotent: the same key twice is one tier', async () => {
    const k = key();
    const body = { minPoints: 900, label: 'Sekali saja', action: 'Tindakan', notifyParents: false };
    const first = await post(wakasek, '/point-thresholds', body, school, k).expect(201);
    const replay = await post(wakasek, '/point-thresholds', body, school, k).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as Tier).id).toBe((first.body as Tier).id);
    await put(wakasek, `/point-thresholds/${(first.body as Tier).id}`, { active: false }).expect(200);
  });

  it('edits a tier, refuses a clash and keeps switched-off tiers out of the default list', async () => {
    const edited = await put(wakasek, `/point-thresholds/${tiers['t25']?.id}`, { label: 'Peringatan 2 (BK)', notifyParents: true }).expect(200);
    expect(edited.body).toMatchObject({ minPoints: 25, label: 'Peringatan 2 (BK)', notifyParents: true });
    await put(wakasek, `/point-thresholds/${tiers['t25']?.id}`, { minPoints: 10 }).expect(409);
    await put(wakasek, `/point-thresholds/${tiers['t25']?.id}`, { notifyParents: false }).expect(200);
    await put(wakasek, `/point-thresholds/${uuidv7()}`, { label: 'Tidak ada' }).expect(404);
    const live = tierList(await get(wakasek, '/point-thresholds').expect(200));
    expect(live.map((x) => x.minPoints)).toEqual([10, 25]);
    const all = tierList(await get(wakasek, '/point-thresholds?all=true').expect(200));
    expect(all.map((x) => x.minPoints)).toEqual([10, 25, 900]);
    // Only the managers may ask for the switched-off ones.
    expect(tierList(await get(kepsek, '/point-thresholds?all=true').expect(200)).map((x) => x.minPoints)).toEqual([10, 25]);
  });

  it('is read by admin, kepsek, wakasek, wali kelas and guru BK; written by admin and wakasek', async () => {
    for (const agent of [admin, kepsek, wakasek, wali, guruBk]) await get(agent, '/point-thresholds').expect(200);
    await get(guru, '/point-thresholds').expect(403);
    for (const agent of [kepsek, wali, guru, guruBk]) {
      await post(agent, '/point-thresholds', { minPoints: 77, label: 'Dilarang', action: 'Tindakan', notifyParents: true }).expect(403);
      await put(agent, `/point-thresholds/${tiers['t10']?.id}`, { label: 'Dilarang' }).expect(403);
    }
  });

  it('keeps tiers per school and honours the capability', async () => {
    expect(tierList(await get(otherAdmin, '/point-thresholds', otherSchool).expect(200))).toEqual([]);
    await put(otherAdmin, `/point-thresholds/${tiers['t10']?.id}`, { label: 'Sekolah lain' }, otherSchool).expect(404);
    const off = await get(offAdmin, '/point-thresholds', offSchool).expect(404);
    expect(off.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
  });
});

describe('crossing a tier makes one follow-up task (KSW-03)', () => {
  it('makes a task when the total reaches a tier and one for every tier a big entry jumps over', async () => {
    await violate(guru, 'ANI BERTINGKAT', 'late'); // 5
    expect(await tasksOf('ANI BERTINGKAT')).toHaveLength(0);
    await violate(guru, 'ANI BERTINGKAT', 'late'); // 10: tier 10
    const first = await tasksOf('ANI BERTINGKAT');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ label: 'Peringatan 1', action: 'Panggil orang tua', minPoints: 10, totalPoints: 10, status: 'open', student: { className: '8B' } });
    await violate(wali, 'ANI BERTINGKAT', 'fight'); // 60: tier 25
    const both = await tasksOf('ANI BERTINGKAT');
    expect(both.map((x) => [x.minPoints, x.totalPoints]).sort()).toEqual([[10, 10], [25, 60]]);
    expect(await events(both.map((x) => x.id))).toHaveLength(2);
  });

  it('does not repeat a task when the total falls back and climbs over the same tier again', async () => {
    const before = await tasksOf('ANI BERTINGKAT');
    const entries = ((await get(wakasek, `/students/${students['ANI BERTINGKAT']}/points`).expect(200)).body as { items: { id: string; rule: string; reversed: boolean }[] }).items;
    const fight = entries.find((e) => e.rule === 'Berkelahi' && !e.reversed);
    await post(wakasek, `/point-entries/${fight?.id}/reverse`, { reason: 'Salah orang' }).expect(201);
    await violate(guru, 'ANI BERTINGKAT', 'fight');
    const after = await tasksOf('ANI BERTINGKAT');
    expect(after.map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort());
    expect(await events(after.map((x) => x.id))).toHaveLength(2);
  });

  it('counts only pelanggaran: a prestasi crosses nothing, and a reversal makes no task', async () => {
    await violate(guru, 'DINA PRESTASI', 'small');
    await post(guru, '/point-entries', { enrollmentId: students['DINA PRESTASI'], ruleId: rules['champion'] }).expect(201);
    expect(await tasksOf('DINA PRESTASI')).toHaveLength(0);
  });

  it('notices a tier two entries cross together, because recording is serialised per student', async () => {
    await Promise.all([violate(guru, 'BUDI BERSAMAAN', 'late'), violate(wali, 'BUDI BERSAMAAN', 'late')]); // 5 + 5 = 10
    const tasks = await tasksOf('BUDI BERSAMAAN');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ minPoints: 10, totalPoints: 10 });
    expect(await events([tasks[0]?.id ?? ''])).toHaveLength(1);
  });

  it('ignores a switched-off tier and does not reach back for a tier made later', async () => {
    await put(wakasek, `/point-thresholds/${tiers['t10']?.id}`, { active: false }).expect(200);
    await violate(guru, 'CICI SUSULAN', 'late');
    await violate(guru, 'CICI SUSULAN', 'late'); // 10, but tier 10 is off
    expect(await tasksOf('CICI SUSULAN')).toHaveLength(0);
    await put(wakasek, `/point-thresholds/${tiers['t10']?.id}`, { active: true }).expect(200);
    await violate(guru, 'CICI SUSULAN', 'small'); // 11: tier 10 is behind her, not crossed now
    expect(await tasksOf('CICI SUSULAN')).toHaveLength(0);
  });

  it('keeps the tier as it was in the task when the tier is edited later', async () => {
    await put(wakasek, `/point-thresholds/${tiers['t10']?.id}`, { label: 'Peringatan Satu', action: 'Surat panggilan' }).expect(200);
    const [task] = (await tasksOf('ANI BERTINGKAT')).filter((x) => x.minPoints === 10);
    expect(task).toMatchObject({ label: 'Peringatan 1', action: 'Panggil orang tua' });
  });
});

describe('follow-up tasks (KSW-03)', () => {
  it('is seen by leaders and BK in full and by a wali kelas for their own class only', async () => {
    await violate(guru, 'EKO KELAS C', 'fight'); // 50: tiers 10 and 25 in 8C
    const ofC = (agent: Agent) => agent.get('/api/v1/followup-tasks').set('X-School-Id', school);
    for (const agent of [admin, kepsek, wakasek, guruBk]) {
      const names = new Set(taskList(await ofC(agent).expect(200)).map((x) => x.student.name));
      expect(names).toEqual(new Set(['ANI BERTINGKAT', 'BUDI BERSAMAAN', 'EKO KELAS C']));
    }
    expect(new Set(taskList(await ofC(wali).expect(200)).map((x) => x.student.name))).toEqual(new Set(['ANI BERTINGKAT', 'BUDI BERSAMAAN']));
    expect(new Set(taskList(await ofC(otherWali).expect(200)).map((x) => x.student.name))).toEqual(new Set(['EKO KELAS C']));
    await ofC(guru).expect(403);
  });

  it('filters by status', async () => {
    const open = taskList(await get(admin, '/followup-tasks?status=open').expect(200));
    const done = taskList(await get(admin, '/followup-tasks?status=done').expect(200));
    expect(open.length).toBeGreaterThan(0);
    expect(done).toEqual([]);
    await get(admin, '/followup-tasks?status=maybe').expect(400);
  });

  it('closes a task once, keeping who did it and an encrypted note, and audits it without the note', async () => {
    const [task] = (await tasksOf('EKO KELAS C')).filter((x) => x.minPoints === 10);
    for (const agent of [guru, kepsek, otherAdmin]) await post(agent, `/followup-tasks/${task?.id}/complete`, {}, agent === otherAdmin ? otherSchool : school).expect(agent === otherAdmin ? 404 : 403);
    await post(wali, `/followup-tasks/${task?.id}/complete`, { note: 'Bukan kelas saya' }).expect(404);
    const done = await post(otherWali, `/followup-tasks/${task?.id}/complete`, { note: ' Orang tua datang, rahasia keluarga ' }).expect(200);
    expect(done.body).toMatchObject({ id: task?.id, status: 'done', note: 'Orang tua datang, rahasia keluarga', completedBy: { name: 'Bu Wali 8C' } });
    const again = await post(wakasek, `/followup-tasks/${task?.id}/complete`, {}).expect(409);
    expect(again.body).toMatchObject({ details: { reason: 'already_done' } });

    const raw = await getDb().db.execute(sql`select note from followup_tasks where id = ${task?.id}`);
    expect(String((raw.rows[0] as { note: string }).note)).not.toContain('rahasia');
    const [log] = await getDb()
      .db.select({ before: schema.auditLogs.before, after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'ksw.followup_completed'), eq(schema.auditLogs.entityId, task?.id ?? '')));
    expect(log).toMatchObject({ before: { status: 'open' }, after: { status: 'done' } });
    expect(JSON.stringify(log)).not.toContain('rahasia');
    expect(taskList(await get(admin, '/followup-tasks?status=done').expect(200)).map((x) => x.id)).toEqual([task?.id]);
  });

  it('lets two people finish it at once with exactly one winner', async () => {
    const [task] = (await tasksOf('BUDI BERSAMAAN'));
    const results = await Promise.all([post(wali, `/followup-tasks/${task?.id}/complete`, {}), post(guruBk, `/followup-tasks/${task?.id}/complete`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('answers 404 for an unknown task and keeps tasks inside the school', async () => {
    await post(admin, `/followup-tasks/${uuidv7()}/complete`, {}).expect(404);
    expect(taskList(await get(otherAdmin, '/followup-tasks', otherSchool).expect(200))).toEqual([]);
  });

  it('is never deletable by the app role and isolated by RLS', async () => {
    const id = (await tasksOf('ANI BERTINGKAT'))[0]?.id ?? '';
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.followupTasks).where(eq(schema.followupTasks.id, id)))).rejects.toThrow();
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.pointThresholds).where(eq(schema.pointThresholds.id, tiers['t10']?.id ?? '')))).rejects.toThrow();
    expect(await withTenant({ schoolId: otherSchool, userId: null }, (tx) => tx.select({ id: schema.followupTasks.id }).from(schema.followupTasks))).toHaveLength(0);
  });
});
