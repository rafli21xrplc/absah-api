import type { PklSupervisionDay } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoConfirmDue } from '../src/modules/pkl';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';
import { DUDI_POINT, pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
const yesterday = addDays(today, -1);
let w: PklWorld;
const mentors: Record<'a' | 'b', Agent> = {} as never;
const checkins: Record<string, string> = {};
const key = () => `pkl-sup-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object = {}, k = key()) => agent.post(`/api/v1${path}`).set('X-School-Id', w.school).set('Idempotency-Key', k).send(body);
const supervision = (agent: Agent, q = '') => agent.get(`/api/v1/pkl/supervision${q}`).set('X-School-Id', w.school);

async function record(enrollmentId: string, date: string) {
  const r = schema.attendanceRecords;
  const [row] = await getDb()
    .db.select({ status: r.status, source: r.source, sourceRef: r.sourceRef })
    .from(r)
    .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, r.sessionId))
    .where(and(eq(r.enrollmentId, enrollmentId), eq(schema.attendanceSessions.schoolDate, date), eq(schema.attendanceSessions.mode, 'pkl')));
  return row;
}
const checkinRow = async (id: string) => (await getDb().db.select().from(schema.pklCheckins).where(eq(schema.pklCheckins.id, id)))[0];

beforeAll(async () => {
  w = await pklWorld(t, 'SMK Konfirmasi');
  const ids: Record<string, string> = {};
  for (const label of ['a', 'b'] as const) {
    const u = await t.staff(`Mandor ${label.toUpperCase()}`);
    ids[label] = u.id;
    await t.member(w.school, u.id, 'pembimbing_industri');
    mentors[label] = t.agent();
    await signIn(mentors[label], u.email).expect(200);
  }
  await withTenant({ schoolId: w.school, userId: null }, async (tx) => {
    const period = { startsOn: addDays(today, -7), endsOn: addDays(today, 30), schoolMentorId: w.users.pembimbing };
    const placements = await tx
      .insert(schema.pklPlacements)
      .values([
        { schoolId: w.school, enrollmentId: w.enrollments.rizky, partnerId: w.partners.maju, industryMentorId: ids.a, ...period },
        { schoolId: w.school, enrollmentId: w.enrollments.sinta, partnerId: w.partners.maju, industryMentorId: ids.a, ...period },
        { schoolId: w.school, enrollmentId: w.enrollments.bayu, partnerId: w.partners.sentosa, industryMentorId: ids.b, ...period },
      ])
      .returning();
    const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    const pending = (placementId: string, date: string, hoursAgo: number, late = false) => ({
      schoolId: w.school,
      placementId,
      schoolDate: date,
      kind: 'in' as const,
      recordedAt: ago(hoursAgo),
      deviceTime: ago(hoursAgo),
      ...DUDI_POINT,
      distanceM: 30,
      late,
      confirmStatus: 'pending' as const,
    });
    const rows = await tx
      .insert(schema.pklCheckins)
      .values([
        pending(placements[0]?.id ?? '', today, 1, true),
        pending(placements[1]?.id ?? '', today, 1),
        pending(placements[2]?.id ?? '', today, 1),
        pending(placements[2]?.id ?? '', yesterday, 25),
      ])
      .returning();
    checkins.rizky = rows[0]?.id ?? '';
    checkins.sinta = rows[1]?.id ?? '';
    checkins.bayu = rows[2]?.id ?? '';
    checkins.bayuYesterday = rows[3]?.id ?? '';
  });
});

describe('industry supervisor confirmation (PKL-02)', () => {
  it("shows the supervisor their own students' statuses, never coordinates", async () => {
    const res = await supervision(mentors.a).expect(200);
    const dayA = res.body as PklSupervisionDay;
    expect(dayA).toMatchObject({ date: today, pending: 2 });
    expect(dayA.items.map((i) => i.student.name)).toEqual(['RIZKY PRATAMA', 'SINTA DEWI']);
    expect(JSON.stringify(dayA)).not.toMatch(/latitude|longitude|distance/);
    expect(((await supervision(mentors.b).expect(200)).body as PklSupervisionDay).items.map((i) => i.student.name)).toEqual(['BAYU SAPUTRA']);
    await supervision(mentors.a, `?date=${addDays(today, 1)}`).expect(400);
  });

  it("does not let DUDI A confirm a student of DUDI B", async () => {
    await post(mentors.a, '/pkl/checkins/confirm', { checkinIds: [checkins.bayu] }).expect(404);
    await post(mentors.a, `/pkl/checkins/${checkins.bayu ?? ''}/dispute`, { reason: 'Tidak datang' }).expect(404);
    expect((await checkinRow(checkins.bayu ?? ''))?.confirmStatus).toBe('pending');
    expect(await record(w.enrollments.bayu, today)).toBeUndefined();
  });

  it('disputes one student; the dispute goes to review and cannot be repeated', async () => {
    const res = await post(mentors.a, `/pkl/checkins/${checkins.sinta ?? ''}/dispute`, { reason: 'Hari ini tidak masuk, titip absen.' }).expect(200);
    expect((res.body as PklSupervisionDay).items[1]?.checkIn).toMatchObject({ confirmStatus: 'disputed', disputeReason: 'Hari ini tidak masuk, titip absen.' });
    const again = await post(mentors.a, `/pkl/checkins/${checkins.sinta ?? ''}/dispute`, { reason: 'Lagi' }).expect(409);
    expect((again.body as { details: { reason: string } }).details.reason).toBe('not_pending');
    await post(mentors.a, `/pkl/checkins/${checkins.rizky ?? ''}/dispute`, { reason: 'x' }).expect(400);
  });

  it('confirms every pending check-in in one click, replayed with the same key', async () => {
    const k = key();
    const res = await post(mentors.a, '/pkl/checkins/confirm', {}, k).expect(200);
    const dayA = res.body as PklSupervisionDay;
    expect(dayA.pending).toBe(0);
    expect(dayA.items.map((i) => [i.checkIn?.confirmStatus, i.checkIn?.status])).toEqual([
      ['confirmed', 'T'],
      ['disputed', null],
    ]);
    const again = await post(mentors.a, '/pkl/checkins/confirm', {}, k).expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await record(w.enrollments.rizky, today)).toEqual({ status: 'T', source: 'pkl_confirm', sourceRef: checkins.rizky });
    expect(await record(w.enrollments.sinta, today)).toBeUndefined();
    const daily = await getDb().db.select().from(schema.dailyAttendance).where(and(eq(schema.dailyAttendance.enrollmentId, w.enrollments.rizky), eq(schema.dailyAttendance.schoolDate, today)));
    expect(daily[0]?.status).toBe('T');
    expect((await checkinRow(checkins.rizky ?? ''))?.confirmedBy).not.toBeNull();
  });

  it('refuses other roles', async () => {
    await post(w.agents.pembimbing, '/pkl/checkins/confirm').expect(403);
    await supervision(w.agents.humas).expect(403);
  });

  it('auto-confirms check-ins pending for 24 hours (pkl.auto-confirm)', async () => {
    await autoConfirmDue(new Date());
    const old = await checkinRow(checkins.bayuYesterday ?? '');
    expect(old).toMatchObject({ confirmStatus: 'confirmed', confirmedBy: null });
    expect(await record(w.enrollments.bayu, yesterday)).toEqual({ status: 'H', source: 'pkl_confirm', sourceRef: checkins.bayuYesterday });
    expect((await checkinRow(checkins.bayu ?? ''))?.confirmStatus).toBe('pending');
    expect((await checkinRow(checkins.sinta ?? ''))?.confirmStatus).toBe('disputed');
  });
});
