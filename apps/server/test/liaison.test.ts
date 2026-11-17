import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Thread = { student: { name: string; className: string | null }; canPost: boolean; messages: { id: string; body: string | null; senderRole: string; sender: { name: string }; mine: boolean; canRetract: boolean; retractedAt: string | null }[] };
let school: string;
const a: Record<string, Agent> = {};
let ani: string;
let budi: string;
const key = () => `liaison-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object = {}) => agent.post(`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Penghubung');
  const ids: Record<string, string> = {};
  for (const [label, role] of [
    ['admin', 'admin'],
    ['wali', 'guru'],
    ['mapel', 'guru'],
    ['lain', 'guru'],
    ['ortu', 'orang_tua'],
    ['ortuLain', 'orang_tua'],
  ] as const) {
    const u = await t.staff(`Bu ${label}`);
    ids[label] = u.id;
    await t.member(school, u.id, role);
    a[label] = t.agent();
    await signIn(a[label], u.email).expect(200);
  }
  await enableTotp(a.admin as Agent);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [c7a] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: yearId, name: '7A', grade: 7, homeroomTeacherId: ids.wali }).returning();
    const [c7b] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: yearId, name: '7B', grade: 7 }).returning();
    const [s1, s2] = await tx.insert(schema.students).values(['ANI', 'BUDI'].map((name) => ({ schoolId: school, name }))).returning();
    ani = s1?.id ?? '';
    budi = s2?.id ?? '';
    await tx.insert(schema.enrollments).values([
      { schoolId: school, studentId: ani, classId: c7a?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' },
      { schoolId: school, studentId: budi, classId: c7b?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' },
    ]);
    const [subject] = await tx.insert(schema.subjects).values({ schoolId: school, name: 'IPA' }).returning();
    await tx.insert(schema.scheduleSlots).values({ schoolId: school, academicYearId: yearId, ownerType: 'class', ownerId: c7a?.id ?? '', day: 1, period: 1, subjectId: subject?.id ?? '', teacherId: ids.mapel });
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Bu ortu', userId: ids.ortu }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: ani, guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
  });
});

describe('buku penghubung (ORT-07)', () => {
  it('lets the parent, wali kelas and guru mapel write in the student’s thread', async () => {
    const first = (await post(a.ortu as Agent, `/liaison/students/${ani}/messages`, { body: 'Ani besok terlambat, ada kontrol ke dokter.' }).expect(200)).body as Thread;
    expect(first).toMatchObject({ student: { name: 'ANI', className: '7A' }, canPost: true, messages: [{ senderRole: 'orang_tua', mine: true, canRetract: true }] });
    await post(a.wali as Agent, `/liaison/students/${ani}/messages`, { body: 'Baik, terima kasih Bu.' }).expect(200);
    const thread = (await post(a.mapel as Agent, `/liaison/students/${ani}/messages`, { body: 'Tugas IPA bisa menyusul.' }).expect(200)).body as Thread;
    expect(thread.messages.map((m) => [m.senderRole, m.sender.name])).toEqual([
      ['orang_tua', 'Bu ortu'],
      ['wali_kelas', 'Bu wali'],
      ['guru', 'Bu mapel'],
    ]);
    const events = await getDb().db.execute<{ n: number }>(sql`select count(*)::int as n from outbox_events where school_id = ${school}::uuid and type = 'liaison.message_posted'`);
    expect(events.rows[0]?.n).toBe(3);
  });

  it('stores the text encrypted', async () => {
    const res = await getDb().db.execute<{ body: string }>(sql`select body from communication_messages where school_id = ${school}::uuid`);
    expect(res.rows.every((r) => !r.body.includes('dokter') && !r.body.includes('IPA'))).toBe(true);
  });

  it('hides the thread from everyone else with 404', async () => {
    await get(a.lain as Agent, `/liaison/students/${ani}`).expect(404);
    await get(a.ortuLain as Agent, `/liaison/students/${ani}`).expect(404);
    await post(a.lain as Agent, `/liaison/students/${ani}/messages`, { body: 'Halo' }).expect(404);
    await get(a.wali as Agent, `/liaison/students/${budi}`).expect(404); // not their rombel
    expect(((await get(a.lain as Agent, '/liaison/threads').expect(200)).body as { items: unknown[] }).items).toEqual([]);
  });

  it('finds only students the teacher teaches', async () => {
    const mine = (await get(a.mapel as Agent, '/liaison/students?q=an').expect(200)).body as { items: { name: string; className: string }[] };
    expect(mine.items).toEqual([{ id: ani, name: 'ANI', className: '7A' }]);
    expect(((await get(a.lain as Agent, '/liaison/students?q=an').expect(200)).body as { items: unknown[] }).items).toEqual([]);
    expect(((await get(a.wali as Agent, '/liaison/students?q=budi').expect(200)).body as { items: unknown[] }).items).toEqual([]);
    await get(a.wali as Agent, '/liaison/students?q=a').expect(400);
  });

  it('lists threads with unread counts, and marks read', async () => {
    const parentList = (await get(a.ortu as Agent, '/liaison/threads').expect(200)).body as { items: { studentName: string; unread: number }[] };
    expect(parentList.items).toMatchObject([{ studentName: 'ANI', unread: 2 }]);
    await a.ortu?.post(`/api/v1/liaison/students/${ani}/read`).set('X-School-Id', school).expect(204);
    expect(((await get(a.ortu as Agent, '/liaison/threads').expect(200)).body as { items: { unread: number }[] }).items[0]?.unread).toBe(0);
    // Writing marks the thread read: the wali kelas has only the guru mapel's later message unread.
    const waliList = (await get(a.wali as Agent, '/liaison/threads').expect(200)).body as { items: { studentName: string; unread: number }[] };
    expect(waliList.items).toMatchObject([{ studentName: 'ANI', unread: 1 }]);
  });

  it('retracts within 15 minutes only; the admin still reads a retracted message, audited, and cannot write', async () => {
    const thread = (await get(a.wali as Agent, `/liaison/students/${ani}`).expect(200)).body as Thread;
    const waliMsg = thread.messages.find((m) => m.mine);
    const parentMsg = thread.messages.find((m) => m.senderRole === 'orang_tua');
    await post(a.wali as Agent, `/liaison/messages/${parentMsg?.id}/retract`).expect(404); // not theirs
    const after = (await post(a.wali as Agent, `/liaison/messages/${waliMsg?.id}/retract`).expect(200)).body as Thread;
    expect(after.messages.find((m) => m.id === waliMsg?.id)).toMatchObject({ body: null, canRetract: false });

    const seenByParent = (await get(a.ortu as Agent, `/liaison/students/${ani}`).expect(200)).body as Thread;
    expect(seenByParent.messages.find((m) => m.id === waliMsg?.id)?.body).toBeNull();
    const seenByAdmin = (await get(a.admin as Agent, `/liaison/students/${ani}`).expect(200)).body as Thread;
    expect(seenByAdmin.canPost).toBe(false);
    expect(seenByAdmin.messages.find((m) => m.id === waliMsg?.id)?.body).toBe('Baik, terima kasih Bu.');
    const audits = await getDb().db.select({ action: schema.auditLogs.action }).from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['liaison.message_retracted', 'liaison.thread_viewed']));
    await post(a.admin as Agent, `/liaison/students/${ani}/messages`, { body: 'Admin' }).expect(403);

    // 16 minutes later the parent's message is permanent.
    await getDb().db.execute(sql`update communication_messages set created_at = now() - interval '16 minutes' where id = ${parentMsg?.id}::uuid`);
    const late = await post(a.ortu as Agent, `/liaison/messages/${parentMsg?.id}/retract`).expect(409);
    expect(JSON.stringify(late.body)).toContain('15 menit');
  });

  it('follows the capability portal.liaison', async () => {
    await getDb().db.execute(sql`insert into school_capabilities (school_id, key, value) values (${school}::uuid, 'portal.liaison', 'false'::jsonb)`);
    await get(a.ortu as Agent, '/liaison/threads').expect(404);
  });
});
