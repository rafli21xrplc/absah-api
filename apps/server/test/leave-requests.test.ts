import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let parent: Agent;
let wali: Agent;
let otherGuru: Agent;
let wakasek: Agent;
let school: string;
let students: Record<string, string>; // name -> enrollment id
const today = schoolDate('Asia/Jakarta');
const key = () => `izin-${uuidv7()}`;

type Leave = { id: string; status: string; kind: string; reason: string; hasAttachment: boolean; student: { name: string }; requestedBy: { name: string } | null };
const post = (agent: Agent, path: string, body: object = {}) =>
  agent.post(`/api/v1/leave-requests${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const list = async (agent: Agent, status = 'all') =>
  ((await agent.get(`/api/v1/leave-requests?status=${status}`).set('X-School-Id', school).expect(200)).body as { items: Leave[] }).items;
const izin = (name: string, from: number, to: number, extra: object = {}) => ({
  enrollmentId: students[name],
  kind: 'sakit',
  startsOn: addDays(today, from),
  endsOn: addDays(today, to),
  reason: 'Demam, sudah ke puskesmas',
  ...extra,
});
const events = async (type: string) =>
  (
    await getDb()
      .db.select({ payload: schema.outboxEvents.payload })
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, type)))
  ).map((e) => (e.payload as { leaveRequestId: string }).leaveRequestId);

beforeAll(async () => {
  school = await t.school('sd', 'SD Izin');
  const p = await t.staff('Ibu Rina');
  const w = await t.staff('Bu Wali Izin');
  const g = await t.staff('Pak Guru Izin');
  const k = await t.staff('Wakasek Izin');
  await t.member(school, p.id, 'orang_tua');
  await t.member(school, w.id, 'guru');
  await t.member(school, g.id, 'guru');
  await t.member(school, k.id, 'wakasek');
  parent = t.agent();
  await signIn(parent, p.email).expect(200);
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  otherGuru = t.agent();
  await signIn(otherGuru, g.email).expect(200);
  wakasek = t.agent();
  await signIn(wakasek, k.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '3A', grade: 3, homeroomTeacherId: w.id }).returning();
    const rows = await tx.insert(schema.students).values(['RAKA', 'SALSA'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    // Ibu Rina is RAKA's mother, not SALSA's.
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Rina', userId: p.id }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: rows[0]?.id ?? '', guardianId: guardian?.id ?? '', relation: 'ibu', isPrimary: true });
  });
});

describe('izin siswa (IZN)', () => {
  it('a parent requests for their own child only; the wali kelas approves', async () => {
    const mine = (await parent.get('/api/v1/leave-requests/students').set('X-School-Id', school).expect(200)).body as { items: { name: string }[] };
    expect(mine.items.map((s) => s.name)).toEqual(['RAKA']);
    await post(parent, '', izin('SALSA', 0, 0)).expect(404);

    const created = await post(parent, '', izin('RAKA', 0, 2)).expect(200);
    const leave = created.body as Leave;
    expect(leave).toMatchObject({ status: 'pending', kind: 'sakit', reason: 'Demam, sudah ke puskesmas', student: { name: 'RAKA' }, requestedBy: { name: 'Ibu Rina' } });
    expect(await events('leave.requested')).toEqual([leave.id]);

    await post(parent, '', izin('RAKA', 2, 3)).expect(409);
    await post(otherGuru, `/${leave.id}/decide`, { approve: true }).expect(404);
    await post(parent, `/${leave.id}/decide`, { approve: true }).expect(403);
    expect((await list(wali, 'pending')).map((l) => l.id)).toEqual([leave.id]);

    const approved = await post(wali, `/${leave.id}/decide`, { approve: true, note: 'Semoga lekas sembuh' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: { name: 'Bu Wali Izin' }, decisionNote: 'Semoga lekas sembuh' });
    expect(await events('leave.approved')).toEqual([leave.id]);
    await post(wali, `/${leave.id}/decide`, { approve: false }).expect(409);

    // The reason is stored encrypted.
    const stored = await getDb().db.execute<{ reason: string }>(sql`select reason from leave_requests where id = ${leave.id}`);
    expect(stored.rows[0]?.reason).not.toContain('Demam');
  });

  it('the wali kelas can enter izin for a parent (approved at once) and cancel it', async () => {
    const created = await post(wali, '', izin('SALSA', -1, -1, { kind: 'izin', reason: 'Acara keluarga, ibu menelepon' })).expect(200);
    const leave = created.body as Leave;
    expect(leave.status).toBe('approved');
    expect(await events('leave.approved')).toContain(leave.id);
    expect((await list(parent)).map((l) => l.student.name)).toEqual(['RAKA']);

    await post(otherGuru, `/${leave.id}/cancel`).expect(404);
    const cancelled = await post(wali, `/${leave.id}/cancel`).expect(200);
    expect((cancelled.body as Leave).status).toBe('cancelled');
    expect(await events('leave.cancelled')).toEqual([leave.id]);
    await post(wali, `/${leave.id}/cancel`).expect(409);
  });

  it('rejects bad dates and keeps a pending cancellation quiet', async () => {
    const tooOld = await post(parent, '', izin('RAKA', -8, -8)).expect(400);
    expect((tooOld.body as { details: { path: string }[] }).details.map((d) => d.path)).toEqual(['startsOn']);
    await post(parent, '', izin('RAKA', 5, 4)).expect(400);

    const pending = (await post(parent, '', izin('RAKA', 6, 6, { kind: 'izin' })).expect(200)).body as Leave;
    await post(parent, `/${pending.id}/cancel`).expect(200);
    expect(await events('leave.cancelled')).not.toContain(pending.id);
    const rejected = (await post(parent, '', izin('RAKA', 6, 6, { kind: 'izin' })).expect(200)).body as Leave;
    await post(wakasek, `/${rejected.id}/decide`, { approve: false, note: 'Bukan hari libur keluarga' }).expect(200);
    expect(await events('leave.rejected')).toEqual([rejected.id]);
  });

  it('keeps an attachment private behind a short-lived link', async () => {
    const up = await post(parent, '/attachments', { fileSize: 4, contentType: 'image/png' }).expect(200);
    const body = up.body as { attachmentId: string; upload: { url: string; headers: Record<string, string> } };
    const created = await post(parent, '', izin('RAKA', 10, 10, { attachment: { id: body.attachmentId, contentType: 'image/png' } })).expect(400);
    expect((created.body as { details: { path: string }[] }).details[0]?.path).toBe('attachment');

    const putUrl = new URL(body.upload.url);
    await parent.put(putUrl.pathname + putUrl.search).set(body.upload.headers).send(Buffer.from('PNG!')).expect(200);
    const leave = (await post(parent, '', izin('RAKA', 10, 10, { attachment: { id: body.attachmentId, contentType: 'image/png' } })).expect(200)).body as Leave;
    expect(leave.hasAttachment).toBe(true);

    await otherGuru.get(`/api/v1/leave-requests/${leave.id}/attachment`).set('X-School-Id', school).expect(404);
    const link = (await wali.get(`/api/v1/leave-requests/${leave.id}/attachment`).set('X-School-Id', school).expect(200)).body as { url: string };
    const getUrl = new URL(link.url);
    const file = await wali.get(getUrl.pathname + getUrl.search).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.from(file.body as Buffer).toString()).toBe('PNG!');
    await wali.get(getUrl.pathname + getUrl.search.replace('image%2Fpng', 'text%2Fhtml')).expect(403);
  });

  it('replays a request with the same Idempotency-Key', async () => {
    const k = key();
    const send = () => parent.post('/api/v1/leave-requests').set('X-School-Id', school).set('Idempotency-Key', k).send(izin('RAKA', 12, 12));
    const first = await send().expect(200);
    const again = await send().expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as Leave).id).toBe((first.body as Leave).id);
  });
});
