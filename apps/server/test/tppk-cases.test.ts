import { schema } from '@absah/db';
import { and, eq, like } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Summary = { id: string; status: string; caseId: string | null; isAnonymous: boolean };
type Detail = Summary & { chronology: string; reporter: { name: string | null; account: { name: string } | null } | null };
type CaseDetail = { id: string; status: string; summary: string; reportId: string | null; report: Detail | null; events: { kind: string; note: string; createdBy: { name: string } | null }[] };
const CHRONOLOGY = 'Siswa kelas 8 dipukul kakak kelas di toilet lantai dua saat istirahat.';
let school: string;
let member: Agent;
let member2: Agent;
let admin: Agent;
let kepsek: Agent;
let guru: Agent;
let anonCode: string;
let caseId: string;
const key = () => `tppk-case-${uuidv7()}`;

const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);
const post = (agent: Agent, path: string, body: object, k = key()) => agent.post(`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', k).send(body);
const reportIds = async (agent: Agent) => ((await get(agent, '/tppk/reports').expect(200)).body as { items: Summary[] }).items;
const audits = (action: string) =>
  getDb()
    .db.select({ actor: schema.auditLogs.actorUserId, entityId: schema.auditLogs.entityId, after: schema.auditLogs.after })
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, action)));

beforeAll(async () => {
  school = await t.school('smp', 'SMP Kasus TPPK');
  const people: Record<string, { id: string; email: string }> = {};
  for (const [label, role] of [
    ['m1', 'guru'],
    ['m2', 'wali_kelas'],
    ['admin', 'admin'],
    ['kepsek', 'kepsek'],
    ['guru', 'guru'],
  ] as const) {
    people[label] = await t.staff(`Staf ${label}`);
    await t.member(school, people[label].id, role);
  }
  await getDb()
    .db.insert(schema.tppkMembers)
    .values([people.m1, people.m2].map((p) => ({ schoolId: school, userId: p?.id ?? '' })));
  const agentFor = async (label: string, totp = false) => {
    const a = t.agent();
    await signIn(a, people[label]?.email ?? '').expect(200);
    if (totp) await enableTotp(a);
    return a;
  };
  member = await agentFor('m1');
  member2 = await agentFor('m2');
  admin = await agentFor('admin', true);
  kepsek = await agentFor('kepsek', true);
  guru = await agentFor('guru');

  const filed = await t
    .agent()
    .post('/api/v1/tppk/reports')
    .send({ schoolId: school, category: 'fisik', chronology: CHRONOLOGY, reporterRelation: 'siswa', anonymous: true, occurredOn: '2026-11-16' })
    .expect(201);
  anonCode = (filed.body as { trackingCode: string }).trackingCode;
  await guru
    .post('/api/v1/tppk/reports')
    .send({ schoolId: school, category: 'psikis', chronology: 'Seorang guru sering merendahkan siswa di depan kelas.', reporterRelation: 'guru', anonymous: false, reporterName: 'Staf guru' })
    .expect(201);
});

describe('who may open reports and cases (KSW-07)', () => {
  it('refuses admin, kepsek and a guru who is not on the team', async () => {
    for (const agent of [admin, kepsek, guru]) {
      const res = await get(agent, '/tppk/reports').expect(403);
      expect((res.body as { message: string }).message).toContain('anggota TPPK');
      await get(agent, '/tppk/cases').expect(403);
      await post(agent, '/tppk/cases', { summary: 'Kasus dari luar tim' }).expect(403);
    }
  });

  it('lists reports to a member, newest first, without the text', async () => {
    const items = await reportIds(member);
    expect(items.map((r) => [r.isAnonymous, r.status, r.caseId])).toEqual([
      [false, 'diterima', null],
      [true, 'diterima', null],
    ]);
    expect(JSON.stringify(items)).not.toContain('toilet');
    expect(await audits('tppk.reports_listed')).toContainEqual(expect.objectContaining({ after: { status: null, count: 2 } }));
  });

  it('shows the chronology and the named reporter, never a reporter for an anonymous report', async () => {
    const [named, anonymous] = await reportIds(member);
    const anon = (await get(member, `/tppk/reports/${anonymous?.id ?? ''}`).expect(200)).body as Detail;
    expect(anon).toMatchObject({ chronology: CHRONOLOGY, reporter: null });
    const withName = (await get(member, `/tppk/reports/${named?.id ?? ''}`).expect(200)).body as Detail;
    expect(withName.reporter).toMatchObject({ name: 'Staf guru', account: { name: 'Staf guru' } });
    expect((await audits('tppk.report_viewed')).map((a) => a.entityId)).toContain(anonymous?.id);
  });
});

describe('handling a case', () => {
  it('opens a case from a report: the reporter sees "ditangani"', async () => {
    const reports = await reportIds(member);
    const anonymous = reports.find((r) => r.isAnonymous);
    const res = await post(member, '/tppk/cases', { reportId: anonymous?.id, summary: 'Pemukulan di toilet lantai dua' }).expect(200);
    const detail = res.body as CaseDetail;
    caseId = detail.id;
    expect(detail).toMatchObject({ status: 'open', summary: 'Pemukulan di toilet lantai dua', report: { chronology: CHRONOLOGY, status: 'ditangani' }, events: [] });
    expect((await t.agent().get(`/api/v1/tppk/reports/track/${anonCode}`).expect(200)).body).toEqual({ status: 'ditangani' });
    await post(member2, '/tppk/cases', { reportId: anonymous?.id, summary: 'Kasus kedua' }).expect(409);
  });

  it('records notes and steps by any member, in order', async () => {
    await post(member, `/tppk/cases/${caseId}/events`, { kind: 'langkah', note: 'Memanggil korban dengan didampingi wali kelas.' }).expect(200);
    const res = await post(member2, `/tppk/cases/${caseId}/events`, { kind: 'catatan', note: 'Korban meminta identitasnya dirahasiakan.' }).expect(200);
    expect((res.body as CaseDetail).events.map((e) => [e.kind, e.createdBy?.name])).toEqual([
      ['langkah', 'Staf m1'],
      ['catatan', 'Staf m2'],
    ]);
  });

  it('closes: the report is "selesai", the case takes no more notes until reopened', async () => {
    const closed = await post(member, `/tppk/cases/${caseId}/close`, { note: 'Mediasi selesai, orang tua kedua pihak hadir.' }).expect(200);
    expect((closed.body as CaseDetail).status).toBe('closed');
    expect((await t.agent().get(`/api/v1/tppk/reports/track/${anonCode}`).expect(200)).body).toEqual({ status: 'selesai' });
    await post(member, `/tppk/cases/${caseId}/events`, { kind: 'catatan', note: 'Terlambat' }).expect(409);
    await post(member, `/tppk/cases/${caseId}/close`, { note: 'Lagi' }).expect(409);

    const reopened = await post(member2, `/tppk/cases/${caseId}/reopen`, { note: 'Ada laporan lanjutan dari korban.' }).expect(200);
    expect((reopened.body as CaseDetail).events.map((e) => e.kind)).toEqual(['langkah', 'catatan', 'ditutup', 'dibuka_kembali']);
    expect((await t.agent().get(`/api/v1/tppk/reports/track/${anonCode}`).expect(200)).body).toEqual({ status: 'ditangani' });
  });

  it('opens a case without a report and lists cases by status', async () => {
    await post(member, '/tppk/cases', { summary: 'Temuan langsung piket: ejekan berulang di grup kelas' }).expect(200);
    const open = (await get(member, '/tppk/cases?status=open').expect(200)).body as { items: { reportId: string | null }[] };
    expect(open.items).toHaveLength(2);
    expect(open.items[0]?.reportId).toBeNull();
    const closedOnly = (await get(member, '/tppk/cases?status=closed').expect(200)).body as { items: unknown[] };
    expect(closedOnly.items).toHaveLength(0);
  });

  it('audits every read and change with ids only, never the text', async () => {
    await get(member, `/tppk/cases/${caseId}`).expect(200);
    const rows = await getDb()
      .db.select({ action: schema.auditLogs.action, after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), like(schema.auditLogs.action, 'tppk.%')));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['tppk.case_opened', 'tppk.case_event_added', 'tppk.case_closed', 'tppk.case_reopened', 'tppk.case_viewed', 'tppk.cases_listed', 'tppk.report_viewed']) {
      expect(actions).toContain(a);
    }
    const text = JSON.stringify(rows);
    for (const secret of ['toilet', 'dirahasiakan', 'Mediasi', 'Pemukulan']) expect(text).not.toContain(secret);
  });

  it('validates input and answers 404 for an unknown case', async () => {
    await post(member, `/tppk/cases/${caseId}/events`, { kind: 'ditutup', note: 'Bukan lewat sini' }).expect(400);
    await post(member, '/tppk/cases', { summary: 'x' }).expect(400);
    await get(member, `/tppk/cases/${uuidv7()}`).expect(404);
  });
});
