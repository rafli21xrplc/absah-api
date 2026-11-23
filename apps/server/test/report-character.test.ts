import type { ExportDownload, ExportJob } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportConsumers } from '../src/modules/report';
import { buildCharacterReport } from '../src/modules/report/application/character-report';
import { findJob } from '../src/modules/report/infrastructure/export-repo';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let wakasek: Agent;
let wali: Agent;
let otherWali: Agent;
let guru: Agent;
const ids = { semester: '', classA: '', classB: '' };
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const post = (agent: Agent, body: object) => agent.post('/api/v1/exports/character-reports').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send(body);
const request = (classId: string) => ({ semesterId: ids.semester, classId });

async function build(jobId: string) {
  const [event] = await getDb()
    .db.select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'export.requested'), sql`${schema.outboxEvents.payload}->>'exportJobId' = ${jobId}`));
  const consumer = reportConsumers(t.storage)[0];
  if (!event || !consumer) throw new Error('no export event');
  return runConsumer(consumer, { id: event.id, schoolId: school, type: event.type, payload: event.payload, traceId: null, occurredAt: event.createdAt.toISOString() });
}

beforeAll(async () => {
  school = await t.school('sma', 'SMA Karakter');
  const [k, w, o, g] = await Promise.all([t.staff('Wakasek Karakter'), t.staff('Bu Wali Karakter'), t.staff('Bu Wali Lain'), t.staff('Pak Guru Karakter')]);
  await t.member(school, k.id, 'wakasek');
  for (const p of [w, o, g]) await t.member(school, p.id, 'guru');
  [wakasek, wali, otherWali, guru] = [t.agent(), t.agent(), t.agent(), t.agent()];
  await signIn(wakasek, k.email).expect(200);
  await signIn(wali, w.email).expect(200);
  await signIn(otherWali, o.email).expect(200);
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const academicYearId = year?.id ?? '';
    const [sem] = await tx.insert(schema.semesters).values({ schoolId: school, academicYearId, number: 1, startsOn: '2026-07-13', endsOn: '2026-12-19' }).returning();
    ids.semester = sem?.id ?? '';
    const [a, b] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId, name: 'X-1', grade: 10, homeroomTeacherId: w.id },
        { schoolId: school, academicYearId, name: 'X-2', grade: 10, homeroomTeacherId: o.id },
      ])
      .returning();
    ids.classA = a?.id ?? '';
    ids.classB = b?.id ?? '';
    const enroll = async (name: string, classId: string, status: 'active' | 'moved' = 'active') => {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name, nisn: name === 'ANI' ? '0091234567' : null }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId, academicYearId, startsOn: '2026-07-13', status }).returning();
      return e?.id ?? '';
    };
    const ani = await enroll('ANI', ids.classA);
    const budi = await enroll('BUDI', ids.classA);
    await enroll('CITRA', ids.classA, 'moved');
    await enroll('DEWI', ids.classB);

    await tx.insert(schema.dailyAttendance).values([
      { schoolId: school, enrollmentId: ani, schoolDate: '2026-08-03', status: 'H' },
      { schoolId: school, enrollmentId: ani, schoolDate: '2026-08-04', status: 'T' },
      { schoolId: school, enrollmentId: ani, schoolDate: '2026-08-05', status: 'S' },
      { schoolId: school, enrollmentId: ani, schoolDate: '2027-01-05', status: 'A' }, // after the semester
      { schoolId: school, enrollmentId: budi, schoolDate: '2026-08-03', status: 'A' },
    ]);

    // Points: Ani one achievement (+10) and violations -5 and -3, one violation outside the semester.
    const [good, bad] = await tx
      .insert(schema.pointRules)
      .values([
        { schoolId: school, kind: 'achievement', category: 'Lomba', name: 'Juara lomba', points: 10 },
        { schoolId: school, kind: 'violation', category: 'Tata tertib', name: 'Terlambat', points: -5 },
      ])
      .returning();
    const entry = (enrollmentId: string, rule: typeof good, occurredOn: string, points: number) => ({
      schoolId: school,
      enrollmentId,
      ruleId: rule?.id ?? '',
      kind: rule?.kind ?? 'violation',
      category: rule?.category ?? '',
      ruleName: rule?.name ?? '',
      points,
      occurredOn,
    });
    await tx.insert(schema.pointEntries).values([entry(ani, good, '2026-09-01', 10), entry(ani, bad, '2026-09-02', -5), entry(ani, bad, '2026-09-03', -3), entry(ani, bad, '2027-02-01', -5)]);

    // Habits: Ani did beribadah 3 of 4 days and bangun_pagi 1 of 1.
    const habit = (enrollmentId: string, schoolDate: string, h: 'beribadah' | 'bangun_pagi', value: boolean) => ({ schoolId: school, enrollmentId, schoolDate, habit: h, value, filledByRole: 'orang_tua' });
    await tx.insert(schema.habitEntries).values([
      habit(ani, '2026-08-03', 'beribadah', true),
      habit(ani, '2026-08-04', 'beribadah', true),
      habit(ani, '2026-08-05', 'beribadah', true),
      habit(ani, '2026-08-06', 'beribadah', false),
      habit(ani, '2026-08-03', 'bangun_pagi', true),
    ]);

    // Activity: Ani joins Pramuka, which met twice in the semester; she was there once (hadir) and once sakit.
    const [pramuka] = await tx.insert(schema.activities).values({ schoolId: school, academicYearId, name: 'Pramuka', kind: 'ekskul', location: 'sekolah', days: [5] }).returning();
    await tx.insert(schema.activityMembers).values({ schoolId: school, activityId: pramuka?.id ?? '', enrollmentId: ani });
    for (const [date, status] of [['2026-08-07', 'H'], ['2026-08-14', 'S']] as const) {
      const [s] = await tx
        .insert(schema.attendanceSessions)
        .values({ schoolId: school, schoolDate: date, mode: 'activity', ownerType: 'activity', ownerId: pramuka?.id ?? '', activityId: pramuka?.id, status: 'locked' })
        .returning();
      await tx.insert(schema.attendanceRecords).values({ schoolId: school, sessionId: s?.id ?? '', enrollmentId: ani, status, source: 'teacher' });
    }
  });
});

describe('character report (KEG-04)', () => {
  it('queues for the wali kelas of the rombel and managers; no one else', async () => {
    const job = bodyOf<ExportJob>(await post(wali, request(ids.classA)).expect(202));
    expect(job).toMatchObject({ status: 'queued', target: 'rapor_karakter', format: 'pdf', class: { name: 'X-1' } });
    await post(wakasek, request(ids.classB)).expect(202);
    await post(otherWali, request(ids.classA)).expect(403);
    await post(guru, request(ids.classA)).expect(403);
    await post(wali, { ...request(uuidv7()) }).expect(404);
  });

  it('gathers attendance, points, habits and activities of the semester per student', async () => {
    const job = bodyOf<ExportJob>(await post(wali, request(ids.classA)).expect(202));
    const report = await withTenant({ schoolId: school, userId: null }, async (tx) => {
      const row = await findJob(tx, job.id);
      if (!row) throw new Error('job missing');
      return buildCharacterReport(tx, school, row);
    });
    expect(report).toMatchObject({ className: 'X-1', principalTitle: 'Kepala Sekolah', semester: { number: 1 } });
    // CITRA moved away: not on the report. DEWI is in another rombel.
    expect(report.students.map((s) => s.name)).toEqual(['ANI', 'BUDI']);
    const [ani, budi] = report.students;
    expect(ani).toMatchObject({ nisn: '0091234567', counts: { H: 1, T: 1, S: 1, I: 0, A: 0 }, achievementPoints: 10, violationPoints: 8 });
    expect(ani?.presentRate).toBeCloseTo(2 / 3, 2);
    expect(ani?.habits).toHaveLength(7);
    expect(ani?.habits.find((h) => h.habit === 'beribadah')).toEqual({ habit: 'beribadah', yes: 3, filled: 4 });
    expect(ani?.habits.find((h) => h.habit === 'tidur_cepat')).toEqual({ habit: 'tidur_cepat', yes: 0, filled: 0 });
    expect(ani?.activities).toEqual([{ name: 'Pramuka', kind: 'ekskul', recorded: 2, present: 1 }]);
    expect(budi).toMatchObject({ counts: { A: 1 }, achievementPoints: 0, violationPoints: 0, activities: [] });
  });

  it('builds the PDF in the worker and downloads it through the export routes', async () => {
    const job = bodyOf<ExportJob>(await post(wali, request(ids.classA)).expect(202));
    expect(await build(job.id)).toBe('handled');
    const done = bodyOf<ExportJob>((await wali.get(`/api/v1/exports/${job.id}`).set('X-School-Id', school).expect(200)));
    expect(done).toMatchObject({ status: 'done', fileName: 'rapor-karakter-2026-2027-sem1-X-1.pdf' });
    const link = bodyOf<ExportDownload>(await wali.get(`/api/v1/exports/${job.id}/download`).set('X-School-Id', school).expect(200));
    const res = await t.agent().get(new URL(link.url).pathname + new URL(link.url).search).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Only the requester sees the file.
    await otherWali.get(`/api/v1/exports/${job.id}/download`).set('X-School-Id', school).expect(404);
  });
});
