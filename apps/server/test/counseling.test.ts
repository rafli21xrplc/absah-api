import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Note = { id: string; student: { enrollmentId: string; name: string; className: string }; date: string; note: string; followUp: string; followUpOn: string | null; followedUpAt: string | null; recordedBy: { name: string } | null };

const today = schoolDate('Asia/Jakarta');
let school: string;
let otherSchool: string;
let offSchool: string;
let ids: Record<string, string>;
let bk: Agent;
let otherBk: Agent;
let admin: Agent;
let wali: Agent;
let kepsek: Agent;
let wakasek: Agent;
let guru: Agent;
let offBk: Agent;
let enrollments: Record<string, string>;
let otherEnrollment: string;
const key = () => `bk-${uuidv7()}`;

const post = (agent: Agent, path: string, body: object, schoolId = school, k = key()) => agent.post(`/api/v1${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const get = (agent: Agent, path: string, schoolId = school) => agent.get(`/api/v1${path}`).set('X-School-Id', schoolId);
const write = (agent: Agent, body: object, schoolId = school, k = key()) => post(agent, '/counseling-notes', body, schoolId, k);
const items = (res: { body: unknown }) => (res.body as { items: Note[] }).items;
/** The Postgres message behind a failed query (Drizzle wraps it), or null when the query went through. */
const refusal = async (query: Promise<unknown>): Promise<string | null> => {
  try {
    await query;
    return null;
  } catch (err) {
    return (err as { cause?: { message?: string } }).cause?.message ?? String(err);
  }
};
const rowsAs = (schoolId: string, userId: string | null) => withTenant({ schoolId, userId }, (tx) => tx.select({ id: schema.counselingNotes.id }).from(schema.counselingNotes));

async function seed(schoolId: string, className: string, homeroom: string | null, names: string[]) {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: className, grade: 8, homeroomTeacherId: homeroom }).returning();
    const rows = await tx.insert(schema.students).values(names.map((name) => ({ schoolId, name }))).returning();
    const enrolled = await tx.insert(schema.enrollments).values(rows.map((s) => ({ schoolId, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }))).returning();
    return Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
  });
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Konseling');
  otherSchool = await t.school('smp', 'SMP Konseling Lain');
  offSchool = await t.school('smp', 'SMP Tanpa BK');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: offSchool, key: 'student.counseling', value: false });
  const people = {
    bk: await t.staff('Bu BK Konseling'),
    otherBk: await t.staff('BK Sekolah Lain'),
    admin: await t.staff('Admin Konseling'),
    wali: await t.staff('Bu Wali 8B'),
    kepsek: await t.staff('Kepsek Konseling'),
    wakasek: await t.staff('Wakasek Konseling'),
    guru: await t.staff('Pak Guru Konseling'),
    offBk: await t.staff('BK Tanpa Fitur'),
  };
  ids = Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v.id]));
  await t.member(school, people.bk.id, 'guru_bk');
  await t.member(otherSchool, people.otherBk.id, 'guru_bk');
  await t.member(school, people.admin.id, 'admin');
  await t.member(school, people.wali.id, 'wali_kelas');
  await t.member(school, people.kepsek.id, 'kepsek');
  await t.member(school, people.wakasek.id, 'wakasek');
  await t.member(school, people.guru.id, 'guru');
  await t.member(offSchool, people.offBk.id, 'guru_bk');
  const login = async (email: string, twoFactor = false): Promise<Agent> => {
    const agent = t.agent();
    await signIn(agent, email).expect(200);
    // Admins act in a school only with two-factor on (PLT-01).
    if (twoFactor) await enableTotp(agent);
    return agent;
  };
  bk = await login(people.bk.email);
  otherBk = await login(people.otherBk.email);
  admin = await login(people.admin.email, true);
  wali = await login(people.wali.email);
  kepsek = await login(people.kepsek.email);
  wakasek = await login(people.wakasek.email);
  guru = await login(people.guru.email);
  offBk = await login(people.offBk.email);
  enrollments = await seed(school, '8B', people.wali.id, ['ANI KONSELING', 'BUDI KONSELING', 'CICI PINDAH']);
  otherEnrollment = Object.values(await seed(otherSchool, '8A', null, ['SISWA SEKOLAH LAIN']))[0] ?? '';
  await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.enrollments).set({ status: 'left', endsOn: today }).where(eq(schema.enrollments.id, enrollments['CICI PINDAH'] ?? '')));
});

describe('POST /counseling-notes (KSW-05)', () => {
  it('lets the guru BK write a note, answering with it decrypted', async () => {
    const res = await write(bk, { enrollmentId: enrollments['ANI KONSELING'], note: ' Bercerita soal masalah keluarga. ' }).expect(201);
    expect(res.body).toMatchObject({ date: today, note: 'Bercerita soal masalah keluarga.', followUp: 'none', followUpOn: null, followedUpAt: null, student: { name: 'ANI KONSELING', className: '8B' }, recordedBy: { name: 'Bu BK Konseling' } });
  });

  it('plans a follow-up, optionally with a date', async () => {
    const on = addDays(today, 7);
    const res = await write(bk, { enrollmentId: enrollments['ANI KONSELING'], note: 'Perlu bertemu orang tua minggu depan.', followUp: 'planned', followUpOn: on }).expect(201);
    expect(res.body).toMatchObject({ followUp: 'planned', followUpOn: on });
    await write(bk, { enrollmentId: enrollments['BUDI KONSELING'], note: 'Pantau minggu ini.', followUp: 'planned', date: addDays(today, -2) }).expect(201);
  });

  it('rejects empty and over-long notes, a future date, a follow-up date without a plan or before the session, and unknown fields', async () => {
    const base = { enrollmentId: enrollments['ANI KONSELING'], note: 'Catatan' };
    await write(bk, { ...base, note: '   ' }).expect(400);
    await write(bk, { ...base, note: 'x'.repeat(2001) }).expect(400);
    await write(bk, { ...base, date: addDays(today, 1) }).expect(400);
    await write(bk, { ...base, followUpOn: addDays(today, 3) }).expect(400);
    await write(bk, { ...base, followUp: 'planned', followUpOn: addDays(today, -1) }).expect(400);
    await write(bk, { ...base, followUp: 'done' }).expect(400);
    await write(bk, { ...base, followedUpAt: today }).expect(400);
  });

  it('refuses a student that is not active here', async () => {
    await write(bk, { enrollmentId: enrollments['CICI PINDAH'], note: 'Sudah pindah' }).expect(404);
    await write(bk, { enrollmentId: uuidv7(), note: 'Tidak ada' }).expect(404);
    await write(bk, { enrollmentId: otherEnrollment, note: 'Sekolah lain' }).expect(404);
  });

  it('is idempotent: the same key twice is one note', async () => {
    const k = key();
    const body = { enrollmentId: enrollments['BUDI KONSELING'], note: 'Sekali saja' };
    const first = await write(bk, body, school, k).expect(201);
    const replay = await write(bk, body, school, k).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as Note).id).toBe((first.body as Note).id);
    expect((await getDb().db.select({ id: schema.counselingNotes.id }).from(schema.counselingNotes).where(eq(schema.counselingNotes.id, (first.body as Note).id)))).toHaveLength(1);
  });

  it('is written by the guru BK only: not even admin, wali kelas, kepsek, wakasek or guru', async () => {
    for (const agent of [admin, wali, kepsek, wakasek, guru]) await write(agent, { enrollmentId: enrollments['ANI KONSELING'], note: 'Tidak boleh' }).expect(403);
  });

  it('answers 404 CAPABILITY_DISABLED when student.counseling is off', async () => {
    const res = await write(offBk, { enrollmentId: uuidv7(), note: 'Mati' }, offSchool).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
  });
});

describe('GET /counseling-notes (KSW-05)', () => {
  it('is read by the guru BK and by admin', async () => {
    for (const agent of [bk, admin]) expect(items(await get(agent, '/counseling-notes').expect(200)).length).toBeGreaterThanOrEqual(4);
  });

  it('is refused to the wali kelas of the very student, and to kepsek, wakasek and guru', async () => {
    for (const agent of [wali, kepsek, wakasek, guru]) {
      await get(agent, '/counseling-notes').expect(403);
      await get(agent, `/counseling-notes?enrollmentId=${enrollments['ANI KONSELING']}`).expect(403);
    }
  });

  it('filters by student and by follow-up status, newest first', async () => {
    const ani = items(await get(bk, `/counseling-notes?enrollmentId=${enrollments['ANI KONSELING']}`).expect(200));
    expect(new Set(ani.map((n) => n.student.name))).toEqual(new Set(['ANI KONSELING']));
    const dates = ani.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    const planned = items(await get(bk, '/counseling-notes?followUp=planned').expect(200));
    expect(planned.length).toBeGreaterThanOrEqual(2);
    expect(new Set(planned.map((n) => n.followUp))).toEqual(new Set(['planned']));
    await get(bk, '/counseling-notes?followUp=maybe').expect(400);
    await get(bk, '/counseling-notes?enrollmentId=nope').expect(400);
  });

  it('shows nothing of another school, even to a guru BK there', async () => {
    expect(items(await get(otherBk, '/counseling-notes', otherSchool).expect(200))).toEqual([]);
    await get(otherBk, '/counseling-notes').expect(403); // not a member of this school
  });
});

describe('POST /counseling-notes/{id}/complete (KSW-05)', () => {
  const planned = async () => (await write(bk, { enrollmentId: enrollments['BUDI KONSELING'], note: 'Tindak lanjut', followUp: 'planned' }).expect(201)).body as Note;

  it('marks a planned follow-up done once, leaving the note as it was', async () => {
    const n = await planned();
    const done = await post(bk, `/counseling-notes/${n.id}/complete`, {}).expect(200);
    expect(done.body).toMatchObject({ id: n.id, followUp: 'done', note: 'Tindak lanjut' });
    expect((done.body as Note).followedUpAt).not.toBeNull();
    const again = await post(bk, `/counseling-notes/${n.id}/complete`, {}).expect(409);
    expect(again.body).toMatchObject({ details: { reason: 'not_planned' } });
  });

  it('refuses a note with nothing planned, an unknown note and every other role', async () => {
    const none = (await write(bk, { enrollmentId: enrollments['BUDI KONSELING'], note: 'Tanpa rencana' }).expect(201)).body as Note;
    await post(bk, `/counseling-notes/${none.id}/complete`, {}).expect(409);
    await post(bk, `/counseling-notes/${uuidv7()}/complete`, {}).expect(404);
    const n = await planned();
    for (const agent of [admin, wali, kepsek, wakasek, guru]) await post(agent, `/counseling-notes/${n.id}/complete`, {}).expect(403);
    await post(otherBk, `/counseling-notes/${n.id}/complete`, {}, otherSchool).expect(404);
  });

  it('lets two requests finish it at once with exactly one winner', async () => {
    const n = await planned();
    const results = await Promise.all([post(bk, `/counseling-notes/${n.id}/complete`, {}), post(bk, `/counseling-notes/${n.id}/complete`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('the database keeps BK notes from everyone else (KSW-05)', () => {
  it('shows rows to the guru BK and admin of the school and to nobody else', async () => {
    expect((await rowsAs(school, ids['bk'] ?? '')).length).toBeGreaterThan(0);
    expect((await rowsAs(school, ids['admin'] ?? '')).length).toBeGreaterThan(0);
    for (const who of ['wali', 'kepsek', 'wakasek', 'guru']) expect(await rowsAs(school, ids[who] ?? '')).toEqual([]);
    expect(await rowsAs(school, null)).toEqual([]); // a background job
    expect(await rowsAs(school, uuidv7())).toEqual([]); // an unknown user
    expect(await rowsAs(school, ids['otherBk'] ?? '')).toEqual([]); // a guru BK of another school
    expect(await rowsAs(otherSchool, ids['bk'] ?? '')).toEqual([]); // the same BK looking through another school
  });

  it('refuses a write by anyone but the guru BK', async () => {
    const row = { schoolId: school, enrollmentId: enrollments['ANI KONSELING'] ?? '', sessionDate: today, note: sql`'x'` as never };
    const insert = (who: string) => withTenant({ schoolId: school, userId: ids[who] ?? '' }, (tx) => tx.insert(schema.counselingNotes).values({ ...row, id: uuidv7() }));
    for (const who of ['wali', 'admin', 'kepsek']) expect(await refusal(insert(who))).toMatch(/row-level security/);
    await expect(insert('bk')).resolves.toBeDefined(); // the same insert goes through for the guru BK, so the refusals above are the policy's
  });

  it('lets only follow_up and followed_up_at change, and never deletes', async () => {
    const [target] = await getDb().db.select({ id: schema.counselingNotes.id }).from(schema.counselingNotes).where(eq(schema.counselingNotes.followUp, 'none')).limit(1);
    const id = target?.id ?? '';
    const asBk = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ schoolId: school, userId: ids['bk'] ?? '' }, fn);
    expect(await refusal(asBk((tx) => tx.execute(sql`update counseling_notes set note = 'diubah' where id = ${id}`)))).toMatch(/permission denied/);
    expect(await refusal(asBk((tx) => tx.execute(sql`update counseling_notes set enrollment_id = enrollment_id where id = ${id}`)))).toMatch(/permission denied/);
    expect(await refusal(asBk((tx) => tx.delete(schema.counselingNotes).where(eq(schema.counselingNotes.id, id))))).toMatch(/permission denied/);
    await expect(asBk((tx) => tx.execute(sql`update counseling_notes set follow_up = 'planned' where id = ${id}`))).resolves.toBeDefined(); // the allowed columns do work
    // Admin cannot update either: the row is not visible for update, so nothing changes.
    const changed = await withTenant({ schoolId: school, userId: ids['admin'] ?? '' }, (tx) => tx.update(schema.counselingNotes).set({ followUp: 'planned' }).where(eq(schema.counselingNotes.id, id)).returning({ id: schema.counselingNotes.id }));
    expect(changed).toEqual([]);
  });

  it('stores the note encrypted', async () => {
    const note = 'Rahasia sangat pribadi 98765';
    const n = (await write(bk, { enrollmentId: enrollments['ANI KONSELING'], note }).expect(201)).body as Note;
    const raw = await getDb().db.execute(sql`select note from counseling_notes where id = ${n.id}`);
    expect(String((raw.rows[0] as { note: string }).note)).not.toContain('Rahasia');
  });
});

describe('audit (KSW-05)', () => {
  it('records who wrote and who read, never the note', async () => {
    const logs = await getDb().db.select({ action: schema.auditLogs.action, after: schema.auditLogs.after }).from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school));
    const mine = logs.filter((l) => l.action.startsWith('ksw.counseling_'));
    expect(new Set(mine.map((l) => l.action))).toEqual(new Set(['ksw.counseling_recorded', 'ksw.counseling_read', 'ksw.counseling_followup_done']));
    expect(JSON.stringify(logs)).not.toMatch(/Rahasia|keluarga|orang tua minggu depan|Tindak lanjut/);
    expect(mine.find((l) => l.action === 'ksw.counseling_read')?.after).toMatchObject({ count: expect.any(Number) as number });
  });
});
