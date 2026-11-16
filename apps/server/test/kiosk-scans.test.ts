import { deviceDayKey, makeCardToken, schoolDayKey } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool, generateForSchool } from '../src/modules/attendance';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { schoolDate, schoolMinutes } from '../src/shared/school-date';
import { bindCards, gateSchool, tokenMaker } from './gate-fixtures';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let school: string;
let kiosk: Awaited<ReturnType<typeof gateSchool>>;
let cards: Map<string, { cardId: string; deviceId: string }>;
let students: Record<string, string>; // name -> student id
let enrollments: Record<string, string>; // name -> enrollment id
let token: Awaited<ReturnType<typeof tokenMaker>>;

type Result = { clientEventId: string; result: string; rejectReason: string | null; outcome: string | null; firstName: string | null };
const scan = (tok: string, ms = Date.now()) => ({ clientEventId: uuidv7(), token: tok, scannedAt: new Date(ms).toISOString() });
const send = async (scans: object[], key?: string) => ((await kiosk.post('/kiosk/scans', { scans }, key).expect(200)).body as { results: Result[] }).results;
const card = (name: string) => cards.get(students[name] ?? '') ?? { cardId: '', deviceId: '' };

async function recordOf(name: string) {
  const [row] = await getDb()
    .db.select({ status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, schema.attendanceRecords.sessionId))
    .where(and(eq(schema.attendanceRecords.enrollmentId, enrollments[name] ?? ''), eq(schema.attendanceSessions.schoolDate, today)));
  return row ? `${row.status}:${row.source}` : null;
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Kios Scan');
  kiosk = await gateSchool(t, school);
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '5A', grade: 5 }).returning();
    const rows = await tx.insert(schema.students).values(['NADIA PUTRI', 'RIZKY', 'TONO'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s) => [s.name, s.id]));
    enrollments = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
  });
  cards = await bindCards(school, Object.values(students));
});

describe('GET /kiosk/day', () => {
  it('gives the day keys, the school start and first names of bound cards', async () => {
    const day = (await kiosk.get('/kiosk/day').expect(200)).body as { schoolDate: string; lateAfter: string; keys: { schoolDate: string }[]; cards: { firstName: string }[] };
    expect(day.schoolDate).toBe(today);
    expect(day.lateAfter).toBe('07:00');
    expect(day.keys).toHaveLength(2);
    expect(day.cards.map((c) => c.firstName)).toEqual(['Nadia', 'Rizky', 'Tono']);
    token = await tokenMaker(school);
  });
});

describe('POST /kiosk/scans (GRB-03)', () => {
  it('records each scan exactly once and marks the arrival in attendance, also for sessions created later', async () => {
    const onTime = schoolMinutes('Asia/Jakarta', new Date()) <= 7 * 60;
    const first = [scan(await token(card('NADIA PUTRI'), today, Date.now())), scan(await token(card('RIZKY'), today, Date.now()))];
    const results = await send(first);
    expect(results.map((r) => [r.result, r.outcome, r.firstName])).toEqual([
      ['accepted', onTime ? 'on_time' : 'late', 'Nadia'],
      ['accepted', onTime ? 'on_time' : 'late', 'Rizky'],
    ]);
    // The kiosk lost the answer and sends the same queue again with a new Idempotency-Key.
    expect(await send(first)).toEqual(results);
    const again = await send([scan(await token(card('NADIA PUTRI'), today, Date.now()))]);
    expect(again.map((r) => r.result)).toEqual(['duplicate']);

    // The scans came before 05.00: the session made afterwards is filled from them.
    const row = await withPlatform((tx) => findSchool(tx, school));
    if (!row) throw new Error('no school');
    expect(await generateForSchool(row, today, new Date(), { force: true })).toEqual({ schoolDate: today, created: 1 });
    expect(await recordOf('NADIA PUTRI')).toBe(onTime ? 'H:gate' : 'T:gate');
    expect(await recordOf('TONO')).toBeNull();

    // With the session in place, a scan marks it at once.
    await send([scan(await token(card('TONO'), today, Date.now()))]);
    expect(await recordOf('TONO')).toBe(onTime ? 'H:gate' : 'T:gate');

    const stored = await getDb().db.select({ result: schema.gateScans.result }).from(schema.gateScans).where(eq(schema.gateScans.schoolId, school));
    expect(stored.map((s) => s.result).sort()).toEqual(['accepted', 'accepted', 'accepted', 'duplicate']);
  });

  it('rejects expired tokens, tokens of another school, an old phone and garbage', async () => {
    const now = Date.now();
    const otherSchool = await deviceDayKey(await schoolDayKey(new Uint8Array(32).fill(1), today), card('RIZKY').deviceId);
    const replacedPhone = { ...card('TONO'), deviceId: uuidv7() };
    const results = await send([
      scan(await token(card('RIZKY'), today, now - 3 * 60_000), now),
      scan(await makeCardToken({ ...card('RIZKY'), deviceKey: otherSchool, ms: now }), now),
      scan(await token(replacedPhone, today, now), now),
      scan('https://contoh.id/bukan-kartu', now),
      scan(await token(card('RIZKY'), today, now + 10 * 60_000), now + 10 * 60_000),
    ]);
    expect(results.map((r) => [r.result, r.rejectReason])).toEqual([
      ['rejected', 'expired'],
      ['rejected', 'bad_signature'],
      ['rejected', 'wrong_device'],
      ['rejected', 'malformed'],
      ['rejected', 'expired'],
    ]);
  });

  it('requires an Idempotency-Key and a kiosk token', async () => {
    await kiosk.post('/kiosk/scans', { scans: [] }).expect(400);
    await request(t.app).post('/api/v1/kiosk/scans').set('Idempotency-Key', uuidv7()).send({ scans: [] }).expect(401);
  });
});
