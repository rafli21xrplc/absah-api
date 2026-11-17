import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, signIn, type Agent } from './harness';

// Everything the app logs while these tests run, at info level (request lines included).
const lines: string[] = [];
const sink = new Writable({
  write(chunk: Buffer, _enc, done) {
    lines.push(chunk.toString());
    done();
  },
});
const t = buildTestApp({ logger: pino({ level: 'info' }, sink) });
afterAll(() => t.cleanup());

type Receipt = { trackingCode: string; status: string };
type ErrorBody = { code: string; message: string };
const IP = '203.0.113.77';
const CHRONOLOGY = 'Kronologi-unik-TPPK: kakak kelas memalak di belakang kantin setiap Senin.';
let school: string;
let closed: string;
let memberId: string;
let reporter: Agent;
let reporterId: string;

const report = (agent: Agent, body: object) => agent.post('/api/v1/tppk/reports').send(body);
const base = () => ({ schoolId: school, category: 'perundungan', chronology: CHRONOLOGY, reporterRelation: 'siswa', anonymous: true });
const track = (code: string, agent = t.agent()) => agent.get(`/api/v1/tppk/reports/track/${encodeURIComponent(code)}`);

/** Reports as a TPPK member sees them (RLS), with the stored values. */
const asMember = () =>
  withTenant({ schoolId: school, userId: memberId }, (tx) =>
    tx
      .select({
        id: schema.tppkReports.id,
        isAnonymous: schema.tppkReports.isAnonymous,
        reporterUserId: schema.tppkReports.reporterUserId,
        reporterName: schema.tppkReports.reporterName,
        chronology: schema.tppkReports.chronology,
        trackingCodeHash: schema.tppkReports.trackingCodeHash,
      })
      .from(schema.tppkReports)
      .orderBy(schema.tppkReports.createdAt),
  );

beforeAll(async () => {
  school = await t.school('smp', 'SMP Lapor');
  closed = await t.school('smp', 'SMP Kanal Tutup');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: closed, key: 'student.tppk', value: false });
  const m = await t.staff('Anggota TPPK');
  memberId = m.id;
  await t.member(school, m.id, 'guru');
  await getDb().db.insert(schema.tppkMembers).values({ schoolId: school, userId: m.id });
  const r = await t.staff('Guru Pelapor');
  reporterId = r.id;
  await t.member(school, r.id, 'guru');
  reporter = t.agent();
  await signIn(reporter, r.email).expect(200);
});

describe('GET /tppk/channel/{schoolId}', () => {
  it('names an open school and answers the same 404 for a closed or unknown one', async () => {
    expect((await t.agent().get(`/api/v1/tppk/channel/${school}`).expect(200)).body).toEqual({ schoolName: 'SMP Lapor' });
    const off = await t.agent().get(`/api/v1/tppk/channel/${closed}`).expect(404);
    const unknown = await t.agent().get('/api/v1/tppk/channel/01900000-0000-7000-8000-000000000000').expect(404);
    expect((off.body as ErrorBody).message).toBe((unknown.body as ErrorBody).message);
  });
});

describe('POST /tppk/reports (KSW-06)', () => {
  let code: string;

  it('takes an anonymous report without login and keeps nothing about the reporter', async () => {
    const res = await report(t.agent(IP), base()).expect(201);
    const receipt = res.body as Receipt;
    code = receipt.trackingCode;
    expect(receipt.status).toBe('diterima');
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);

    const [row] = await asMember();
    expect(row).toMatchObject({ isAnonymous: true, reporterUserId: null, reporterName: null });
    expect(row?.chronology.reveal()).toBe(CHRONOLOGY);
    expect(row?.trackingCodeHash).not.toContain(code);

    const [entry] = await getDb()
      .db.select({ actor: schema.auditLogs.actorUserId, ipHash: schema.auditLogs.ipHash, after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'tppk.report_filed')));
    expect(entry).toEqual({ actor: null, ipHash: null, after: { category: 'perundungan', anonymous: true } });

    const events = await getDb()
      .db.select({ payload: schema.outboxEvents.payload })
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'tppk.report_received')));
    expect(events).toEqual([{ payload: { reportId: row?.id } }]);
  });

  it('stores the chronology encrypted, not as plain text', async () => {
    const raw = await getDb().db.execute<{ chronology: string }>(sql`select chronology from tppk.reports where school_id = ${school}`);
    expect(raw.rows[0]?.chronology).not.toContain('kantin');
  });

  it('keeps the account of a signed-in reporter who chooses to give their name, but not when anonymous', async () => {
    await report(reporter, { ...base(), anonymous: false, reporterRelation: 'guru', reporterName: 'Pak Guru', reporterContact: '0812 0000 1111' }).expect(201);
    await report(reporter, { ...base(), reporterRelation: 'guru' }).expect(201);
    const rows = await asMember();
    expect(rows.slice(1).map((r) => [r.isAnonymous, r.reporterUserId, r.reporterName?.reveal() ?? null])).toEqual([
      [false, reporterId, 'Pak Guru'],
      [true, null, null],
    ]);
  });

  it('refuses a name on an anonymous report, a short story and a closed school', async () => {
    await report(t.agent(), { ...base(), reporterName: 'Nama' }).expect(400);
    await report(t.agent(), { ...base(), chronology: 'terlalu pendek' }).expect(400);
    await report(t.agent(), { ...base(), schoolId: closed }).expect(404);
  });

  it('limits one client to 5 reports an hour; another client is not affected', async () => {
    const agent = t.agent('198.51.100.9');
    for (let i = 0; i < 5; i++) await report(agent, base()).expect(201);
    const sixth = await report(agent, base()).expect(429);
    expect((sixth.body as ErrorBody).code).toBe('RATE_LIMITED');
    await report(t.agent('198.51.100.10'), base()).expect(201);
  });

  describe('GET /tppk/reports/track/{code}', () => {
    it('shows the status only, also for a code typed in lower case with a dash', async () => {
      expect((await track(code, t.agent(IP)).expect(200)).body).toEqual({ status: 'diterima' });
      const typed = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();
      expect((await track(typed).expect(200)).body).toEqual({ status: 'diterima' });
    });

    it('answers a wrong and a malformed code exactly alike', async () => {
      const wrong = await track('ABCDEFGHJK').expect(404);
      const malformed = await track('bukan-kode!').expect(404);
      const strip = (b: unknown) => ({ code: (b as ErrorBody).code, message: (b as ErrorBody).message });
      expect(strip(wrong.body)).toEqual(strip(malformed.body));
      expect(strip(wrong.body)).toEqual({ code: 'NOT_FOUND', message: 'Kode lacak tidak ditemukan.' });
    });

    it('follows the case: a member moving the report on changes what the reporter sees', async () => {
      await withTenant({ schoolId: school, userId: memberId }, (tx) => tx.update(schema.tppkReports).set({ status: 'ditangani' }));
      expect((await track(code).expect(200)).body).toEqual({ status: 'ditangani' });
    });

    it('never puts the IP, the chronology or the tracking code in the application log', () => {
      const log = lines.join('');
      expect(log).toContain('/tppk/reports/track/[code]'); // the request lines are there, masked
      expect(log).not.toContain(IP);
      expect(log).not.toContain('kantin');
      expect(log).not.toContain(code);
      expect(log.toLowerCase()).not.toContain(code.toLowerCase());
    });
  });
});
