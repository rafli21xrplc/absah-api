import { schema, sensitive } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Team = { items: { userId: string; name: string }[]; minimum: number; belowMinimum: boolean };
let school: string;
let other: string;
const ids: Record<string, string> = {};
let admin: Agent;
let kepsek: Agent;
let guru: Agent;
let reportId: string;
const key = () => `tppk-${uuidv7()}`;

const putTeam = (agent: Agent, userIds: string[]) =>
  agent.put('/api/v1/tppk/members').set('X-School-Id', school).set('Idempotency-Key', key()).send({ userIds });
const getTeam = (agent: Agent) => agent.get('/api/v1/tppk/members').set('X-School-Id', school);

/** A report as the public endpoint writes it: plain INSERT, no RETURNING. */
async function fileReport(schoolId: string, userId: string | null, codeHash = `hash-${uuidv7()}`) {
  const id = uuidv7();
  await withTenant({ schoolId, userId }, (tx) =>
    tx.insert(schema.tppkReports).values({
      id,
      schoolId,
      category: 'perundungan',
      chronology: sensitive('Kronologi rahasia'),
      reporterRelation: 'siswa',
      isAnonymous: true,
      trackingCodeHash: codeHash,
    }),
  );
  return id;
}

/** Every tppk table as seen by one user in one school. */
async function visible(schoolId: string, userId: string | null) {
  return withTenant({ schoolId, userId }, async (tx) => ({
    reports: (await tx.select({ id: schema.tppkReports.id }).from(schema.tppkReports)).length,
    cases: (await tx.select({ id: schema.tppkCases.id }).from(schema.tppkCases)).length,
    events: (await tx.select({ id: schema.tppkCaseEvents.id }).from(schema.tppkCaseEvents)).length,
  }));
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP TPPK');
  other = await t.school('smp', 'SMP TPPK Lain');
  for (const [label, role] of [
    ['admin', 'admin'],
    ['kepsek', 'kepsek'],
    ['guru', 'guru'],
    ['bk', 'guru'],
    ['wali', 'wali_kelas'],
    ['piket', 'piket'],
  ] as const) {
    const u = await t.staff(`Staf ${label}`);
    ids[label] = u.id;
    await t.member(school, u.id, role);
    ids[`${label}Email`] = u.email;
  }
  const parent = await t.staff('Orang Tua Bukan Staf');
  ids.parent = parent.id;
  await t.member(school, parent.id, 'orang_tua');
  const outsider = await t.staff('Guru Sekolah Lain');
  ids.outsider = outsider.id;
  await t.member(other, outsider.id, 'guru');

  admin = t.agent();
  await signIn(admin, ids.adminEmail ?? '').expect(200);
  await enableTotp(admin);
  kepsek = t.agent();
  await signIn(kepsek, ids.kepsekEmail ?? '').expect(200);
  await enableTotp(kepsek);
  guru = t.agent();
  await signIn(guru, ids.guruEmail ?? '').expect(200);
});

describe('PUT /tppk/members (admin appoints the team)', () => {
  it('warns below three members and lists the team to any staff member', async () => {
    const res = await putTeam(admin, [ids.bk ?? '', ids.wali ?? '']).expect(200);
    expect(res.body as Team).toMatchObject({ minimum: 3, belowMinimum: true });
    expect((res.body as Team).items.map((m) => m.name).sort()).toEqual(['Staf bk', 'Staf wali']);
    const seen = await getTeam(guru).expect(200);
    expect((seen.body as Team).items).toHaveLength(2);
  });

  it('replaces the team, audits the change and tells the team', async () => {
    const res = await putTeam(admin, [ids.bk ?? '', ids.wali ?? '', ids.piket ?? '']).expect(200);
    expect((res.body as Team).belowMinimum).toBe(false);
    const events = await getDb()
      .db.select({ payload: schema.outboxEvents.payload })
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'tppk.members_changed')));
    expect(events.map((e) => e.payload)).toContainEqual({ added: [ids.piket], removed: [] });
    const [entry] = await getDb()
      .db.select({ after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'tppk.members_changed')))
      .orderBy(sql`${schema.auditLogs.createdAt} desc`)
      .limit(1);
    expect(entry?.after).toEqual({ added: [ids.piket], removed: [] });
  });

  it('accepts only active staff of this school', async () => {
    const parent = await putTeam(admin, [ids.bk ?? '', ids.parent ?? '']).expect(400);
    expect(JSON.stringify(parent.body)).toContain('staf aktif');
    await putTeam(admin, [ids.bk ?? '', ids.outsider ?? '']).expect(400);
    await putTeam(admin, [ids.bk ?? '', ids.bk ?? '']).expect(400);
  });

  it('is for the admin alone', async () => {
    await putTeam(kepsek, [ids.kepsek ?? '']).expect(403);
    await putTeam(guru, [ids.guru ?? '']).expect(403);
  });

  it('stays behind student.tppk', async () => {
    await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'student.tppk', value: false });
    await getTeam(guru).expect(404);
    await getDb()
      .db.delete(schema.schoolCapabilities)
      .where(and(eq(schema.schoolCapabilities.schoolId, school), eq(schema.schoolCapabilities.key, 'student.tppk')));
  });
});

describe('RLS on the tppk schema', () => {
  beforeAll(async () => {
    // Anyone may file a report, including a non-member and a context without a user (public form).
    reportId = await fileReport(school, null, 'hash-known');
    await fileReport(other, null);
    await withTenant({ schoolId: school, userId: ids.bk ?? '' }, async (tx) => {
      const [c] = await tx
        .insert(schema.tppkCases)
        .values({ schoolId: school, reportId, summary: sensitive('Ringkasan'), openedBy: ids.bk ?? null })
        .returning({ id: schema.tppkCases.id });
      await tx.insert(schema.tppkCaseEvents).values({ schoolId: school, caseId: c?.id ?? '', kind: 'catatan', note: sensitive('Catatan'), createdBy: ids.bk ?? null });
    });
  });

  it('gives 0 rows to non-members: admin, kepsek, guru, the system and a member of another school', async () => {
    for (const userId of [ids.admin, ids.kepsek, ids.guru, ids.parent, ids.outsider, null]) {
      expect(await visible(school, userId ?? null)).toEqual({ reports: 0, cases: 0, events: 0 });
    }
  });

  it('shows members their own school only', async () => {
    expect(await visible(school, ids.bk ?? '')).toEqual({ reports: 1, cases: 1, events: 1 });
    expect(await visible(other, ids.bk ?? '')).toEqual({ reports: 0, cases: 0, events: 0 });
  });

  it('lets no non-member change or read back a report', async () => {
    const updated = await withTenant({ schoolId: school, userId: ids.admin ?? '' }, (tx) =>
      tx.update(schema.tppkReports).set({ status: 'selesai' }).where(eq(schema.tppkReports.id, reportId)).returning({ id: schema.tppkReports.id }),
    );
    expect(updated).toEqual([]); // the policy hides the row, so nothing is touched
    const reporter = withTenant({ schoolId: school, userId: null }, (tx) =>
      tx
        .insert(schema.tppkReports)
        .values({ schoolId: school, category: 'fisik', chronology: sensitive('x'), reporterRelation: 'lainnya', isAnonymous: true, trackingCodeHash: `hash-${uuidv7()}` })
        .returning({ id: schema.tppkReports.id }),
    );
    await expect(reporter).rejects.toThrow();
    expect(await withTenant({ schoolId: school, userId: ids.bk ?? '' }, (tx) => tx.select({ status: schema.tppkReports.status }).from(schema.tppkReports))).toEqual([{ status: 'diterima' }]);
  });

  it('cannot add cases or events as a non-member, nor delete anything', async () => {
    const add = withTenant({ schoolId: school, userId: ids.admin ?? '' }, (tx) =>
      tx.insert(schema.tppkCases).values({ schoolId: school, summary: sensitive('Kasus palsu') }),
    );
    await expect(add).rejects.toThrow();
    const del = withTenant({ schoolId: school, userId: ids.bk ?? '' }, (tx) => tx.delete(schema.tppkReports));
    await expect(del).rejects.toThrow();
  });

  it('answers the status by code hash and nothing else, from any context', async () => {
    const status = (hash: string) =>
      withTenant({ schoolId: other, userId: null }, async (tx) => (await tx.execute<{ s: string | null }>(sql`select tppk.report_status(${hash}) as s`)).rows[0]?.s);
    expect(await status('hash-known')).toBe('diterima');
    expect(await status('hash-unknown')).toBeNull();
  });
});
