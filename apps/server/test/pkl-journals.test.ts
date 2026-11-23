import type { PklJournal, PklJournalList } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';
import { pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let w: PklWorld;
let rizky: Agent;
let bayu: Agent;
let mandor: Agent;
const key = () => `pkl-jur-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object, k = key()) => agent.post(`/api/v1/pkl/journals${path}`).set('X-School-Id', w.school).set('Idempotency-Key', k).send(body);
const list = async (agent: Agent, q = '') => ((await agent.get(`/api/v1/pkl/journals${q}`).set('X-School-Id', w.school).expect(200)).body as PklJournalList).items;
const write = (agent: Agent, body: object, k?: string) => post(agent, '', body, k);

async function studentAgent(studentId: string, label: string): Promise<Agent> {
  const u = await t.staff(label);
  await getDb().db.update(schema.students).set({ userId: u.id }).where(eq(schema.students.id, studentId));
  await t.member(w.school, u.id, 'siswa');
  const agent = t.agent();
  await signIn(agent, u.email).expect(200);
  return agent;
}

async function upload(agent: Agent): Promise<string> {
  const up = await post(agent, '/attachments', { fileSize: 4, contentType: 'image/jpeg' }).expect(201);
  const body = up.body as { attachmentId: string; upload: { url: string; headers: Record<string, string> } };
  const url = new URL(body.upload.url);
  await agent.put(url.pathname + url.search).set(body.upload.headers).send(Buffer.from('JPG!')).expect(200);
  return body.attachmentId;
}

beforeAll(async () => {
  w = await pklWorld(t, 'SMK Jurnal');
  const m = await t.parent(testPhone(), 'Pak Mandor');
  await t.member(w.school, m.id, 'pembimbing_industri');
  const mu = await t.staff('Mandor Login');
  await t.member(w.school, mu.id, 'pembimbing_industri');
  await withTenant({ schoolId: w.school, userId: null }, (tx) =>
    tx.insert(schema.pklPlacements).values([
      { schoolId: w.school, enrollmentId: w.enrollments.rizky, partnerId: w.partners.maju, schoolMentorId: w.users.pembimbing, industryMentorId: mu.id, startsOn: addDays(today, -10), endsOn: addDays(today, 30) },
      { schoolId: w.school, enrollmentId: w.enrollments.bayu, partnerId: w.partners.sentosa, schoolMentorId: w.users.guru, startsOn: addDays(today, -2), endsOn: addDays(today, 30) },
    ]),
  );
  rizky = await studentAgent(w.students.rizky, 'Rizky Login');
  bayu = await studentAgent(w.students.bayu, 'Bayu Login');
  mandor = t.agent();
  await signIn(mandor, mu.email).expect(200);
});

describe('jurnal PKL (PKL-03)', () => {
  let journalId: string;

  it('lets the student write today with a photo, replayed with the same key', async () => {
    const photo = await upload(rizky);
    const k = key();
    const body = { activity: 'Memasang kabel jaringan di lantai 2.', competency: 'Instalasi LAN', attachment: { id: photo, contentType: 'image/jpeg' } };
    const res = await write(rizky, body, k).expect(200);
    const j = res.body as PklJournal;
    expect(j).toMatchObject({ date: today, status: 'submitted', attachmentType: 'image/jpeg', partnerName: 'PT Maju Jaya', canReview: false, student: { name: 'RIZKY PRATAMA' } });
    journalId = j.id;
    const again = await write(rizky, body, k).expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const [row] = await getDb().db.select().from(schema.pklJournals).where(eq(schema.pklJournals.id, journalId));
    expect(row?.attachmentKey).toBe(`schools/${w.school}/pkl/${photo}`);
  });

  it('validates dates, the file and the placement', async () => {
    await write(rizky, { activity: 'Besok', date: addDays(today, 1) }).expect(400);
    await write(rizky, { activity: 'Terlalu lama', date: addDays(today, -8) }).expect(400);
    await write(rizky, { activity: 'abc' }).expect(400);
    const missing = await write(rizky, { activity: 'Tanpa unggah', date: addDays(today, -1), attachment: { id: uuidv7(), contentType: 'image/png' } }).expect(400);
    expect((missing.body as { details: { path: string }[] }).details[0]?.path).toBe('attachment');
    // Bayu's placement started two days ago.
    const before = await write(bayu, { activity: 'Sebelum PKL mulai', date: addDays(today, -3) }).expect(409);
    expect((before.body as { details: { reason: string } }).details.reason).toBe('no_placement');
    await post(w.agents.pembimbing, '', { activity: 'Bukan siswa' }).expect(403);
  });

  it('shows journals to the student, their supervisors and leaders only', async () => {
    await write(bayu, { activity: 'Membantu servis printer kantor.' }).expect(200);
    expect((await list(rizky)).map((j) => j.student.name)).toEqual(['RIZKY PRATAMA']);
    expect((await list(w.agents.pembimbing)).map((j) => [j.student.name, j.canReview])).toEqual([['RIZKY PRATAMA', true]]);
    expect((await list(mandor)).map((j) => j.student.name)).toEqual(['RIZKY PRATAMA']);
    expect((await list(w.agents.kepsek)).map((j) => [j.student.name, j.canReview]).sort()).toEqual([
      ['BAYU SAPUTRA', false],
      ['RIZKY PRATAMA', false],
    ]);
    expect(await list(w.agents.guru)).toHaveLength(1);
    await w.agents.guru.get(`/api/v1/pkl/journals/${journalId}/attachment`).set('X-School-Id', w.school).expect(404);
    const link = (await w.agents.pembimbing.get(`/api/v1/pkl/journals/${journalId}/attachment`).set('X-School-Id', w.school).expect(200)).body as { url: string };
    expect(link.url).toContain('/storage/fs/');
  });

  it('asks for a revision, takes the rewrite and is approved by the industry supervisor', async () => {
    await post(w.agents.pembimbing, `/${journalId}/review`, { decision: 'revision' }).expect(400);
    await post(w.agents.guru, `/${journalId}/review`, { decision: 'approved' }).expect(404);
    const revised = (await post(w.agents.pembimbing, `/${journalId}/review`, { decision: 'revision', note: 'Tambahkan alat yang dipakai.' }).expect(200)).body as PklJournal;
    expect(revised).toMatchObject({ status: 'revision', reviewNote: 'Tambahkan alat yang dipakai.' });
    expect(revised.reviewer).toBeTruthy();
    const again = await post(w.agents.pembimbing, `/${journalId}/review`, { decision: 'approved' }).expect(409);
    expect((again.body as { details: { reason: string } }).details.reason).toBe('not_submitted');

    const rewritten = (await write(rizky, { activity: 'Memasang kabel LAN memakai crimping tool dan tester.', attachment: null }).expect(200)).body as PklJournal;
    expect(rewritten).toMatchObject({ id: journalId, status: 'submitted', attachmentType: null });
    expect((await post(mandor, `/${journalId}/review`, { decision: 'approved' }).expect(200)).body).toMatchObject({ status: 'approved' });
    const locked = await write(rizky, { activity: 'Mengubah setelah disetujui.' }).expect(409);
    expect((locked.body as { details: { reason: string } }).details.reason).toBe('approved');
    expect((await list(rizky, '?status=approved')).map((j) => j.id)).toEqual([journalId]);
  });

  it('is behind pkl.enabled', async () => {
    const sma = await t.school('sma', 'SMA tanpa PKL');
    const u = await t.staff('Siswa SMA');
    await t.member(sma, u.id, 'siswa');
    const agent = t.agent();
    await signIn(agent, u.email).expect(200);
    const res = await agent.get('/api/v1/pkl/journals').set('X-School-Id', sma).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });
});
