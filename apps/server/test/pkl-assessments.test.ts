import type { PklAssessmentAspectList, PklAssessmentForm, PklAssessmentList } from '@absah/contracts';
import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';
import { pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let w: PklWorld;
const mentor: Record<'a' | 'b', Agent> = {} as never;
const placement: Record<'rizky' | 'sinta' | 'bayu', string> = { rizky: '', sinta: '', bayu: '' };
let aspects: PklAssessmentAspectList['items'] = [];
const codeOf = (res: { body: unknown }) => (res.body as { code: string; details?: { reason?: string } }).code;
const reasonOf = (res: { body: unknown }) => (res.body as { details?: { reason?: string } }).details?.reason;
const url = (id: string) => `/api/v1/pkl/placements/${id}/assessment`;
const put = (agent: Agent, id: string, body: object) => agent.put(url(id)).set('X-School-Id', w.school).set('Idempotency-Key', uuidv7()).send(body);
const list = async (agent: Agent) => ((await agent.get('/api/v1/pkl/assessments').set('X-School-Id', w.school).expect(200)).body as PklAssessmentList).items;
const scoresFor = (...values: number[]) => ({ scores: aspects.map((a, i) => ({ aspectId: a.id, score: values[i] ?? 0 })) });

beforeAll(async () => {
  w = await pklWorld(t, 'SMK Penilaian DUDI');
  const ids: Record<string, string> = {};
  for (const label of ['a', 'b'] as const) {
    const u = await t.staff(`Mandor ${label.toUpperCase()}`);
    ids[label] = u.id;
    await t.member(w.school, u.id, 'pembimbing_industri');
    mentor[label] = t.agent();
    await signIn(mentor[label], u.email).expect(200);
  }
  await withTenant({ schoolId: w.school, userId: null }, async (tx) => {
    const base = { schoolId: w.school, schoolMentorId: w.users.pembimbing };
    const rows = await tx
      .insert(schema.pklPlacements)
      .values([
        { ...base, enrollmentId: w.enrollments.rizky, partnerId: w.partners.maju, industryMentorId: ids.a, startsOn: addDays(today, -60), endsOn: addDays(today, 10) }, // window open
        { ...base, schoolMentorId: null, enrollmentId: w.enrollments.sinta, partnerId: w.partners.maju, industryMentorId: ids.a, startsOn: addDays(today, -10), endsOn: addDays(today, 60) }, // not yet
        { ...base, schoolMentorId: null, enrollmentId: w.enrollments.bayu, partnerId: w.partners.sentosa, industryMentorId: ids.b, startsOn: addDays(today, -120), endsOn: addDays(today, -40) }, // closed
      ])
      .returning();
    [placement.rizky, placement.sinta, placement.bayu] = [rows[0]?.id ?? '', rows[1]?.id ?? '', rows[2]?.id ?? ''];
  });
});

describe('DUDI assessment form (PKL-04)', () => {
  it('cannot be given before the school has set aspects', async () => {
    const res = await put(mentor.a, placement.rizky, { scores: [{ aspectId: uuidv7(), score: 80 }] }).expect(409);
    expect(reasonOf(res)).toBe('no_aspects');
  });

  it('is open to the industry supervisor of the placement only in its window', async () => {
    const saved = (await w.agents.humas.put('/api/v1/pkl/assessment-aspects').set('X-School-Id', w.school).set('Idempotency-Key', uuidv7()).send({ items: [{ name: 'Disiplin', weight: 2 }, { name: 'Kerja sama', weight: 1 }, { name: 'Keterampilan teknis', weight: 3 }] }).expect(200)).body as PklAssessmentAspectList;
    aspects = saved.items;
    expect(reasonOf(await put(mentor.a, placement.sinta, scoresFor(80, 80, 80)).expect(409))).toBe('window_not_open');
    expect(reasonOf(await put(mentor.b, placement.bayu, scoresFor(80, 80, 80)).expect(409))).toBe('window_closed');
    // Another supervisor's student is not there at all.
    expect(codeOf(await put(mentor.a, placement.bayu, scoresFor(80, 80, 80)).expect(404))).toBe('NOT_FOUND');
    await put(w.agents.pembimbing, placement.rizky, scoresFor(80, 80, 80)).expect(403);
  });

  it('wants every current aspect once', async () => {
    const [first, second] = aspects;
    expect(codeOf(await put(mentor.a, placement.rizky, { scores: [{ aspectId: first?.id, score: 90 }, { aspectId: second?.id, score: 90 }] }).expect(400))).toBe('VALIDATION_FAILED');
    await put(mentor.a, placement.rizky, { scores: [...scoresFor(90, 90, 90).scores, { aspectId: uuidv7(), score: 50 }] }).expect(400);
    await put(mentor.a, placement.rizky, { scores: [{ aspectId: first?.id, score: 101 }] }).expect(400);
  });

  it('keeps the weighted average, and a second submission corrects the first', async () => {
    const given = (await put(mentor.a, placement.rizky, { ...scoresFor(90, 80, 70), note: ' Rajin dan cepat belajar ' }).expect(200)).body as PklAssessmentForm;
    expect(given.window).toBe('open');
    // (90*2 + 80*1 + 70*3) / 6 = 78.3
    expect(given.assessment).toMatchObject({ overall: 78.3, note: 'Rajin dan cepat belajar' });
    expect(given.assessment?.scores.map((s) => [s.aspectName, s.weight, s.score])).toEqual([['Disiplin', 2, 90], ['Kerja sama', 1, 80], ['Keterampilan teknis', 3, 70]]);
    const again = (await put(mentor.a, placement.rizky, scoresFor(100, 100, 100)).expect(200)).body as PklAssessmentForm;
    expect(again.assessment).toMatchObject({ overall: 100, note: null });
    expect(again.assessment?.scores).toHaveLength(3);
  });

  it('keeps the copy of an aspect that is changed later', async () => {
    const [disiplin, kerja] = aspects;
    await w.agents.humas
      .put('/api/v1/pkl/assessment-aspects')
      .set('X-School-Id', w.school)
      .set('Idempotency-Key', uuidv7())
      .send({ items: [{ id: kerja?.id, name: 'Kerja tim', weight: 1 }, { name: 'Inisiatif', weight: 1 }] })
      .expect(200);
    const form = (await mentor.a.get(url(placement.rizky)).set('X-School-Id', w.school).expect(200)).body as PklAssessmentForm;
    expect(form.aspects.map((a) => a.name)).toEqual(['Kerja tim', 'Inisiatif']);
    // The assessment already given still reads as it was given, including the retired aspect.
    expect(form.assessment?.scores.map((s) => s.aspectName)).toEqual(['Disiplin', 'Kerja sama', 'Keterampilan teknis']);
    expect(form.assessment?.overall).toBe(100);
    expect(disiplin?.name).toBe('Disiplin');
  });
});

describe('who sees which assessments (PKL-04)', () => {
  it('shows an industry supervisor their own students, a guru pembimbing theirs, kepsek all', async () => {
    expect((await list(mentor.a)).map((i) => [i.student.name, i.window, i.assessment !== null])).toEqual([['RIZKY PRATAMA', 'open', true], ['SINTA DEWI', 'not_yet', false]]);
    expect((await list(mentor.b)).map((i) => [i.student.name, i.window])).toEqual([['BAYU SAPUTRA', 'closed']]);
    expect((await list(w.agents.pembimbing)).map((i) => i.student.name)).toEqual(['RIZKY PRATAMA']);
    expect((await list(w.agents.kepsek)).map((i) => i.student.name).sort()).toEqual(['BAYU SAPUTRA', 'RIZKY PRATAMA', 'SINTA DEWI']);
    expect(await list(w.agents.guru)).toEqual([]);
    // A single placement outside the caller's students is 404, not 403: no probing.
    await mentor.b.get(url(placement.rizky)).set('X-School-Id', w.school).expect(404);
    await w.agents.guru.get(url(placement.rizky)).set('X-School-Id', w.school).expect(404);
  });
});
