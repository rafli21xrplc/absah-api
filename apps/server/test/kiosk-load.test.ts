import { schema } from '@absah/db';
import { and, count, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool, generateForSchool } from '../src/modules/attendance';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { addKiosk, bindCards, gateSchool, tokenMaker } from './gate-fixtures';
import { buildTestApp } from './harness';

/**
 * Morning rush (docs/architecture.md phase 3 exit: 900 scans in 20 minutes without duplicates):
 * 900 students, 3 kiosks sending batches of 25 in parallel, plus resent batches as after a lost
 * answer. Every student must arrive exactly once. The k6 script (load/kiosk-scans.k6.js) does the
 * same against a running server.
 */
const STUDENTS = 900;
const CLASSES = 30;
const BATCH = 25;

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let school: string;
let cards: { cardId: string; deviceId: string }[];

beforeAll(async () => {
  school = await t.school('sd', 'SD Beban Kios'); // daily sessions: one per rombel
  const studentIds = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const classes = await tx
      .insert(schema.classes)
      .values(Array.from({ length: CLASSES }, (_, i) => ({ schoolId: school, academicYearId: year?.id ?? '', name: `${7 + (i % 3)} ${String.fromCharCode(65 + Math.floor(i / 3))}`, grade: 7 + (i % 3) })))
      .returning();
    const students = await tx
      .insert(schema.students)
      .values(Array.from({ length: STUDENTS }, (_, i) => ({ schoolId: school, name: `SISWA ${i + 1}` })))
      .returning();
    await tx
      .insert(schema.enrollments)
      .values(students.map((s, i) => ({ schoolId: school, studentId: s.id, classId: classes[i % CLASSES]?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })));
    return students.map((s) => s.id);
  });
  cards = [...(await bindCards(school, studentIds)).values()];
}, 120_000);

describe('kiosk morning rush', () => {
  it(`takes ${STUDENTS} scans from 3 kiosks, each student exactly once`, async () => {
    const kiosks = [await gateSchool(t, school, 'Gerbang 1'), await addKiosk(t, school, 'Gerbang 2'), await addKiosk(t, school, 'Gerbang 3')];
    await kiosks[0]?.get('/kiosk/day').expect(200);
    const row = await withPlatform((tx) => findSchool(tx, school));
    if (!row) throw new Error('no school');
    await generateForSchool(row, today, new Date(), { force: true });
    const token = await tokenMaker(school);

    const scans = await Promise.all(cards.map(async (c) => ({ clientEventId: uuidv7(), token: await token(c, today, Date.now()), scannedAt: new Date().toISOString() })));
    const batches = Array.from({ length: Math.ceil(scans.length / BATCH) }, (_, i) => scans.slice(i * BATCH, (i + 1) * BATCH));
    const latencies: number[] = [];
    const send = async (kioskIndex: number, batch: typeof scans) => {
      const started = performance.now();
      const res = await kiosks[kioskIndex]?.post('/kiosk/scans', { scans: batch }).expect(200);
      latencies.push(performance.now() - started);
      return (res?.body as { results: { result: string }[] }).results;
    };

    const started = performance.now();
    for (let i = 0; i < batches.length; i += 3) {
      await Promise.all([0, 1, 2].map((k) => (batches[i + k] ? send(k, batches[i + k] ?? []) : Promise.resolve([]))));
    }
    // Lost answers: some batches are sent again, by the same kiosk, with new Idempotency-Keys.
    const resent = await Promise.all([0, 7, 20, 35].map((i) => send(i % 3, batches[i] ?? [])));
    const elapsed = performance.now() - started;

    expect(resent.flat().every((r) => r.result === 'accepted')).toBe(true);
    const { db } = getDb();
    const [accepted] = await db.select({ n: count() }).from(schema.gateScans).where(and(eq(schema.gateScans.schoolId, school), eq(schema.gateScans.result, 'accepted')));
    const [all] = await db.select({ n: count() }).from(schema.gateScans).where(eq(schema.gateScans.schoolId, school));
    const [marked] = await db
      .select({ n: count() })
      .from(schema.attendanceRecords)
      .where(and(eq(schema.attendanceRecords.schoolId, school), eq(schema.attendanceRecords.source, 'gate')));
    expect([accepted?.n, all?.n, marked?.n]).toEqual([STUDENTS, STUDENTS, STUDENTS]);

    const sorted = latencies.sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    // Far inside the 20-minute target; the bound only catches pathological slowness.
    expect(elapsed).toBeLessThan(120_000);
    process.stdout.write(`kiosk rush: ${STUDENTS} scans in ${(elapsed / 1000).toFixed(1)} s, batch p95 ${p95.toFixed(0)} ms\n`);
  }, 180_000);
});
