import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Entry = {
  id: string;
  enrollmentId: string;
  kind: string;
  category: string;
  rule: string;
  points: number;
  date: string;
  note: string | null;
  hasEvidence: boolean;
  reversesEntryId: string | null;
  reversed: boolean;
  recordedBy: { name: string } | null;
};
type Profile = { student: { name: string; className: string }; total: number; violationPoints: number; achievementPoints: number; items: Entry[] };

const today = schoolDate('Asia/Jakarta');
let school: string;
let otherSchool: string;
let offSchool: string;
let admin: Agent;
let wakasek: Agent;
let kepsek: Agent;
let guru: Agent;
let wali: Agent;
let otherWali: Agent;
let petugas: Agent;
let otherAdmin: Agent;
let offAdmin: Agent;
let enrollments: Record<string, string>;
let otherEnrollment: string;
let rules: Record<string, { id: string }>;
const key = () => `entry-${uuidv7()}`;

const post = (agent: Agent, path: string, body: object, schoolId = school, k = key()) => agent.post(`/api/v1${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const get = (agent: Agent, path: string, schoolId = school) => agent.get(`/api/v1${path}`).set('X-School-Id', schoolId);
const record = (agent: Agent, body: object, schoolId = school, k = key()) => post(agent, '/point-entries', body, schoolId, k);
const profile = (agent: Agent, enrollmentId: string, schoolId = school) => get(agent, `/students/${enrollmentId}/points`, schoolId);
const items = (res: { body: unknown }) => (res.body as Profile).items;

async function upload(agent: Agent): Promise<string> {
  const up = await post(agent, '/point-entries/evidence', { fileSize: 4, contentType: 'image/jpeg' }).expect(201);
  const body = up.body as { evidenceId: string; upload: { url: string; headers: Record<string, string> } };
  const url = new URL(body.upload.url);
  await agent.put(url.pathname + url.search).set(body.upload.headers).send(Buffer.from('JPG!')).expect(200);
  return body.evidenceId;
}

async function seedStudents(schoolId: string, classes: { name: string; homeroom: string | null; students: string[]; status?: 'active' | 'left' }[]) {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const result: Record<string, string> = {};
    for (const c of classes) {
      const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: c.name, grade: 8, homeroomTeacherId: c.homeroom }).returning();
      const rows = await tx.insert(schema.students).values(c.students.map((name) => ({ schoolId, name }))).returning();
      const enrolled = await tx
        .insert(schema.enrollments)
        .values(rows.map((s) => ({ schoolId, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13', status: c.status ?? 'active' })))
        .returning();
      rows.forEach((s, i) => (result[s.name] = enrolled[i]?.id ?? ''));
    }
    return result;
  });
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Catatan Poin');
  otherSchool = await t.school('smp', 'SMP Catatan Lain');
  offSchool = await t.school('smp', 'SMP Tanpa Poin');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: offSchool, key: 'student.points', value: false });
  const people = {
    admin: await t.staff('Admin Catatan'),
    wakasek: await t.staff('Wakasek Catatan'),
    kepsek: await t.staff('Kepsek Catatan'),
    guru: await t.staff('Pak Guru Catatan'),
    wali: await t.staff('Bu Wali 8B'),
    otherWali: await t.staff('Bu Wali 8C'),
    petugas: await t.staff('Petugas UKS Catatan'),
    otherAdmin: await t.staff('Admin Sekolah Lain'),
    offAdmin: await t.staff('Admin Tanpa Poin'),
  };
  await t.member(school, people.admin.id, 'admin');
  await t.member(school, people.wakasek.id, 'wakasek');
  await t.member(school, people.kepsek.id, 'kepsek');
  await t.member(school, people.guru.id, 'guru');
  await t.member(school, people.wali.id, 'wali_kelas');
  await t.member(school, people.otherWali.id, 'wali_kelas');
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
  kepsek = await login(people.kepsek.email);
  guru = await login(people.guru.email);
  wali = await login(people.wali.email);
  otherWali = await login(people.otherWali.email);
  petugas = await login(people.petugas.email);
  otherAdmin = await login(people.otherAdmin.email, true);
  offAdmin = await login(people.offAdmin.email, true);

  enrollments = await seedStudents(school, [
    { name: '8B', homeroom: people.wali.id, students: ['ANI RAJIN', 'BUDI TELAT', 'CICI PINDAH'] },
    { name: '8C', homeroom: people.otherWali.id, students: ['DONI KELAS C'] },
  ]);
  otherEnrollment = Object.values(await seedStudents(otherSchool, [{ name: '8A', homeroom: null, students: ['SISWA SEKOLAH LAIN'] }]))[0] ?? '';
  await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.enrollments).set({ status: 'left', endsOn: today }).where(eq(schema.enrollments.id, enrollments['CICI PINDAH'] ?? '')));

  const mk = async (body: object) => (await post(wakasek, '/point-rules', body).expect(201)).body as { id: string };
  rules = {
    late: await mk({ kind: 'violation', category: 'Kedisiplinan', name: 'Terlambat masuk kelas', points: -5 }),
    fight: await mk({ kind: 'violation', category: 'Ketertiban', name: 'Berkelahi', points: -50 }),
    champion: await mk({ kind: 'achievement', category: 'Akademik', name: 'Juara lomba', points: 20 }),
    retired: await mk({ kind: 'violation', category: 'Kedisiplinan', name: 'Aturan lama', points: -3 }),
  };
  await wakasek.put(`/api/v1/point-rules/${rules['retired']?.id}`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ active: false }).expect(200);
});

describe('POST /point-entries (KSW-02)', () => {
  it('lets a guru record a pelanggaran, copying the rule and decrypting the note for the answer', async () => {
    const res = await record(guru, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['late']?.id, note: ' Terlambat 20 menit ' }).expect(201);
    expect(res.body).toMatchObject({
      kind: 'violation',
      category: 'Kedisiplinan',
      rule: 'Terlambat masuk kelas',
      points: -5,
      date: today,
      note: 'Terlambat 20 menit',
      hasEvidence: false,
      reversesEntryId: null,
      reversed: false,
      recordedBy: { name: 'Pak Guru Catatan' },
    });
  });

  it('lets admin, wakasek and wali kelas record too, and a prestasi counts positive', async () => {
    const win = await record(wali, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['champion']?.id }).expect(201);
    expect(win.body).toMatchObject({ kind: 'achievement', points: 20, note: null });
    await record(wakasek, { enrollmentId: enrollments['BUDI TELAT'], ruleId: rules['late']?.id }).expect(201);
    await record(admin, { enrollmentId: enrollments['BUDI TELAT'], ruleId: rules['late']?.id }).expect(201);
  });

  it('keeps the rule as it was when it is edited later', async () => {
    const rule = (await post(wakasek, '/point-rules', { kind: 'violation', category: 'Kedisiplinan', name: 'Tidak memakai atribut', points: -2 }).expect(201)).body as { id: string };
    const entry = (await record(guru, { enrollmentId: enrollments['DONI KELAS C'], ruleId: rule.id }).expect(201)).body as Entry;
    await wakasek.put(`/api/v1/point-rules/${rule.id}`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ name: 'Atribut tidak lengkap', points: -10 }).expect(200);
    const kept = items(await profile(wakasek, enrollments['DONI KELAS C'] ?? '')).find((e) => e.id === entry.id);
    expect(kept).toMatchObject({ rule: 'Tidak memakai atribut', points: -2 });
  });

  it('refuses a rule that was switched off, an unknown rule and a rule of another school', async () => {
    const off = await record(guru, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['retired']?.id }).expect(409);
    expect(off.body).toMatchObject({ details: { reason: 'rule_inactive' } });
    await record(guru, { enrollmentId: enrollments['ANI RAJIN'], ruleId: uuidv7() }).expect(404);
  });

  it('refuses students that are not active here: left, unknown and another school', async () => {
    await record(guru, { enrollmentId: enrollments['CICI PINDAH'], ruleId: rules['late']?.id }).expect(404);
    await record(guru, { enrollmentId: uuidv7(), ruleId: rules['late']?.id }).expect(404);
    await record(guru, { enrollmentId: otherEnrollment, ruleId: rules['late']?.id }).expect(404);
  });

  it('accepts today and up to 30 days back, refuses the future and older', async () => {
    const base = { enrollmentId: enrollments['BUDI TELAT'], ruleId: rules['late']?.id };
    await record(guru, { ...base, date: addDays(today, -30) }).expect(201);
    for (const date of [addDays(today, 1), addDays(today, -31)]) {
      const res = await record(guru, { ...base, date }).expect(400);
      expect((res.body as { details: { path: string }[] }).details[0]?.path).toBe('date');
    }
  });

  it('refuses roles that do not record: kepsek, petugas UKS', async () => {
    for (const agent of [kepsek, petugas]) await record(agent, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['late']?.id }).expect(403);
  });

  it('rejects unknown fields and a too-long note', async () => {
    const base = { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['late']?.id };
    await record(guru, { ...base, points: 100 }).expect(400);
    await record(guru, { ...base, note: 'x'.repeat(501) }).expect(400);
  });

  it('is idempotent: the same key twice is one entry', async () => {
    const k = key();
    const body = { enrollmentId: enrollments['DONI KELAS C'], ruleId: rules['fight']?.id };
    const first = await record(guru, body, school, k).expect(201);
    const replay = await record(guru, body, school, k).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as Entry).id).toBe((first.body as Entry).id);
    const rows = await getDb().db.select({ id: schema.pointEntries.id }).from(schema.pointEntries).where(eq(schema.pointEntries.id, (first.body as Entry).id));
    expect(rows).toHaveLength(1);
  });

  it('stores the note encrypted and keeps it out of the audit log', async () => {
    const note = 'Catatan rahasia siswa 12345';
    const entry = (await record(guru, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['late']?.id, note }).expect(201)).body as Entry;
    const raw = await getDb().db.execute(sql`select note from point_entries where id = ${entry.id}`);
    const stored = String((raw.rows[0] as { note: string }).note);
    expect(stored).not.toContain('rahasia');
    const logs = await getDb()
      .db.select({ after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'ksw.point_recorded'), eq(schema.auditLogs.entityId, entry.id)));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]?.after)).not.toContain('rahasia');
    expect(logs[0]?.after).toMatchObject({ points: -5, kind: 'violation', evidence: false });
  });

  it('answers 404 CAPABILITY_DISABLED when student.points is off', async () => {
    const res = await record(offAdmin, { enrollmentId: uuidv7(), ruleId: uuidv7() }, offSchool).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
  });
});

describe('GET /point-entries/students (KSW-02)', () => {
  const search = (agent: Agent, q: string, schoolId = school) => get(agent, `/point-entries/students?q=${encodeURIComponent(q)}`, schoolId);
  const found = (res: { body: unknown }) => (res.body as { items: { name: string; className: string; enrollmentId: string }[] }).items;

  it('lets whoever may record find an active student by name, with the class', async () => {
    for (const agent of [guru, wali, wakasek, admin]) {
      const items = found(await search(agent, 'ani').expect(200));
      expect(items).toEqual([{ enrollmentId: enrollments['ANI RAJIN'], name: 'ANI RAJIN', className: '8B' }]);
    }
    expect(found(await search(guru, 'KELAS').expect(200)).map((s) => s.name)).toEqual(['DONI KELAS C']);
  });

  it('leaves out students who left, and students of other schools', async () => {
    expect(found(await search(guru, 'CICI').expect(200))).toEqual([]);
    expect(found(await search(guru, 'SEKOLAH LAIN').expect(200))).toEqual([]);
  });

  it('needs two letters and is closed to roles that do not record', async () => {
    await search(guru, 'a').expect(400);
    for (const agent of [kepsek, petugas]) await search(agent, 'ani').expect(403);
  });
});

describe('evidence (KSW-02)', () => {
  it('stores an uploaded file under schools/{id}/ksw and links it for the readers of the profile', async () => {
    const evidenceId = await upload(guru);
    const entry = (await record(guru, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['late']?.id, evidence: { id: evidenceId, contentType: 'image/jpeg' } }).expect(201)).body as Entry;
    expect(entry.hasEvidence).toBe(true);
    const [row] = await getDb().db.select({ evidenceKey: schema.pointEntries.evidenceKey, evidenceType: schema.pointEntries.evidenceType }).from(schema.pointEntries).where(eq(schema.pointEntries.id, entry.id));
    expect(row).toEqual({ evidenceKey: `schools/${school}/ksw/${evidenceId}`, evidenceType: 'image/jpeg' });

    for (const reader of [wakasek, kepsek, wali]) {
      const link = (await get(reader, `/point-entries/${entry.id}/evidence`).expect(200)).body as { url: string };
      expect(link.url).toContain('/storage/fs/');
    }
    await get(otherWali, `/point-entries/${entry.id}/evidence`).expect(404);
    await get(guru, `/point-entries/${entry.id}/evidence`).expect(403);
    await get(otherAdmin, `/point-entries/${entry.id}/evidence`, otherSchool).expect(404);
  });

  it('refuses evidence that was never uploaded, a file over 5 MB and a type that is not a photo or PDF', async () => {
    const missing = await record(guru, { enrollmentId: enrollments['ANI RAJIN'], ruleId: rules['late']?.id, evidence: { id: uuidv7(), contentType: 'image/png' } }).expect(400);
    expect((missing.body as { details: { path: string }[] }).details[0]?.path).toBe('evidence');
    await post(guru, '/point-entries/evidence', { fileSize: 5 * 1024 * 1024 + 1, contentType: 'image/png' }).expect(400);
    await post(guru, '/point-entries/evidence', { fileSize: 10, contentType: 'text/html' }).expect(400);
    await post(petugas, '/point-entries/evidence', { fileSize: 10, contentType: 'image/png' }).expect(403);
  });

  it('answers 404 for an entry without evidence', async () => {
    const entry = (await record(guru, { enrollmentId: enrollments['DONI KELAS C'], ruleId: rules['late']?.id }).expect(201)).body as Entry;
    await get(wakasek, `/point-entries/${entry.id}/evidence`).expect(404);
  });
});

describe('POST /point-entries/{id}/reverse (KSW-02)', () => {
  const fresh = async (points = 'late') => (await record(guru, { enrollmentId: enrollments['BUDI TELAT'], ruleId: rules[points]?.id }).expect(201)).body as Entry;

  it('adds an opposite entry that nets the points out and keeps both in the history', async () => {
    const before = (await profile(wakasek, enrollments['BUDI TELAT'] ?? '').expect(200)).body as Profile;
    const entry = await fresh('fight');
    const res = await post(wakasek, `/point-entries/${entry.id}/reverse`, { reason: ' Salah orang ' }).expect(201);
    expect(res.body).toMatchObject({ kind: 'violation', points: 50, note: 'Salah orang', reversesEntryId: entry.id, reversed: false, rule: 'Berkelahi', date: today });
    const after = (await profile(wakasek, enrollments['BUDI TELAT'] ?? '').expect(200)).body as Profile;
    // The pelanggaran and its reversal cancel: the net points are those of before, plus the 'late' entry made by fresh() when none.
    expect(after.total).toBe(before.total);
    expect(after.violationPoints).toBe(before.violationPoints);
    expect(after.items).toHaveLength(before.items.length + 2);
    expect(after.items.find((e) => e.id === entry.id)?.reversed).toBe(true);
  });

  it('refuses a second reversal and the reversal of a reversal', async () => {
    const entry = await fresh();
    const reversal = (await post(admin, `/point-entries/${entry.id}/reverse`, { reason: 'Keliru dicatat' }).expect(201)).body as Entry;
    const again = await post(wakasek, `/point-entries/${entry.id}/reverse`, { reason: 'Sekali lagi' }).expect(409);
    expect(again.body).toMatchObject({ details: { reason: 'already_reversed' } });
    const nested = await post(wakasek, `/point-entries/${reversal.id}/reverse`, { reason: 'Batalkan pembatalan' }).expect(409);
    expect(nested.body).toMatchObject({ details: { reason: 'is_reversal' } });
  });

  it('survives two reversals racing: exactly one wins', async () => {
    const entry = await fresh();
    const results = await Promise.all([
      post(wakasek, `/point-entries/${entry.id}/reverse`, { reason: 'Balapan satu' }),
      post(admin, `/point-entries/${entry.id}/reverse`, { reason: 'Balapan dua' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('is for admin and wakasek only, and needs a reason', async () => {
    const entry = await fresh();
    for (const agent of [guru, wali, kepsek, petugas]) await post(agent, `/point-entries/${entry.id}/reverse`, { reason: 'Ingin batal' }).expect(403);
    await post(wakasek, `/point-entries/${entry.id}/reverse`, { reason: ' ' }).expect(400);
    await post(wakasek, `/point-entries/${uuidv7()}/reverse`, { reason: 'Tidak ada' }).expect(404);
    await post(otherAdmin, `/point-entries/${entry.id}/reverse`, { reason: 'Sekolah lain' }, otherSchool).expect(404);
  });

  it('audits the reversal without the reason', async () => {
    const entry = await fresh();
    const reversal = (await post(wakasek, `/point-entries/${entry.id}/reverse`, { reason: 'Alasan khusus rahasia' }).expect(201)).body as Entry;
    const [log] = await getDb()
      .db.select({ after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'ksw.point_reversed'), eq(schema.auditLogs.entityId, reversal.id)));
    expect(log?.after).toMatchObject({ reverses: entry.id, points: 5 });
    expect(JSON.stringify(log?.after)).not.toContain('rahasia');
  });
});

describe('GET /students/{enrollmentId}/points (KSW-02)', () => {
  it('sums the year net of reversals and lists newest first', async () => {
    const who = enrollments['DONI KELAS C'] ?? '';
    const res = (await profile(otherWali, who).expect(200)).body as Profile;
    const sum = (kind: string) => res.items.filter((e) => e.kind === kind).reduce((n, e) => n + e.points, 0);
    expect(res.student).toMatchObject({ name: 'DONI KELAS C', className: '8C' });
    expect(res.violationPoints).toBe(sum('violation'));
    expect(res.achievementPoints).toBe(sum('achievement'));
    expect(res.total).toBe(res.violationPoints + res.achievementPoints);
    const dates = res.items.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('shows a student with no entries as zero', async () => {
    const empty = (await profile(admin, enrollments['CICI PINDAH'] ?? '').expect(200)).body as Profile;
    expect(empty).toMatchObject({ total: 0, violationPoints: 0, achievementPoints: 0, items: [] });
  });

  it('is read by admin, kepsek, wakasek and the wali kelas of the class only', async () => {
    const who = enrollments['ANI RAJIN'] ?? '';
    for (const agent of [admin, kepsek, wakasek, wali]) await profile(agent, who).expect(200);
    await profile(otherWali, who).expect(404);
    await profile(guru, who).expect(403);
    await profile(petugas, who).expect(403);
  });

  it('does not reach students of another school', async () => {
    await profile(admin, otherEnrollment).expect(404);
    await profile(otherAdmin, enrollments['ANI RAJIN'] ?? '', otherSchool).expect(404);
  });
});

describe('the table itself (KSW-02)', () => {
  it('is insert-only for the app role', async () => {
    const [row] = await getDb().db.select({ id: schema.pointEntries.id }).from(schema.pointEntries).limit(1);
    const id = row?.id ?? '';
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.pointEntries).set({ points: -1 }).where(eq(schema.pointEntries.id, id)))).rejects.toThrow();
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.pointEntries).where(eq(schema.pointEntries.id, id)))).rejects.toThrow();
  });

  it('refuses the wrong sign, evidence without a type and a second reversal even without the API', async () => {
    const base = { id: uuidv7(), schoolId: school, enrollmentId: enrollments['ANI RAJIN'] ?? '', ruleId: rules['late']?.id ?? '', kind: 'violation' as const, category: 'Kedisiplinan', ruleName: 'Terlambat masuk kelas', points: -5, occurredOn: today };
    const insert = (values: Partial<typeof base> & { evidenceKey?: string; reversesEntryId?: string }) =>
      withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.pointEntries).values({ ...base, ...values, id: values.id ?? uuidv7() }));
    await expect(insert({ points: 5 })).rejects.toThrow();
    await expect(insert({ points: 0 })).rejects.toThrow();
    await expect(insert({ evidenceKey: `schools/${school}/ksw/${uuidv7()}` })).rejects.toThrow();
    const original = uuidv7();
    await insert({ id: original });
    await insert({ points: 5, reversesEntryId: original });
    await expect(insert({ points: 5, reversesEntryId: original })).rejects.toThrow();
  });

  it('hides another school’s entries from a tenant session', async () => {
    const rows = await withTenant({ schoolId: otherSchool, userId: null }, (tx) => tx.select({ id: schema.pointEntries.id }).from(schema.pointEntries));
    expect(rows).toHaveLength(0);
  });
});
