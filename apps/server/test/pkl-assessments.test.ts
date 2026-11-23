import type { PklAssessmentAspectList, PklAssessmentForm, PklAssessmentList } from '@absah/contracts';
import { schema } from '@absah/db';
import ExcelJS from 'exceljs';
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

describe('results as a file (PKL-04)', () => {
  const fetchFile = async (agent: Agent, query: string) => {
    const res = await agent
      .get(`/api/v1/pkl/assessments/export?${query}`)
      .set('X-School-Id', w.school)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    return res;
  };
  const sheetOf = async (agent: Agent, query: string) => {
    const res = await fetchFile(agent, query);
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    const file = res.body as Buffer;
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    return workbook.getWorksheet('Penilaian DUDI');
  };

  it('gives kepsek every placement with a column per aspect, retired ones included, and the mean at the bottom', async () => {
    const sheet = await sheetOf(w.agents.kepsek, 'format=xlsx');
    expect(sheet?.getRow(1).values).toEqual([undefined, 'No', 'Nama siswa', 'Rombel', 'DUDI', 'Periode', 'Kerja tim', 'Inisiatif', 'Disiplin', 'Kerja sama', 'Keterampilan teknis', 'Nilai akhir', 'Catatan']);
    const rizky = sheet?.getRow(3).values as unknown[];
    expect(rizky[2]).toBe('RIZKY PRATAMA');
    expect(rizky.slice(2, 5)).toEqual(['RIZKY PRATAMA', 'XI TKJ 1', 'PT Maju Jaya']);
    // Given before the aspects changed: no score for "Kerja tim" / "Inisiatif", and the old ones keep theirs.
    expect(rizky.slice(6, 13)).toEqual(['', '', 100, 100, 100, 100, '']);
    // Ordered by DUDI (CV Sentosa first), then by name.
    expect((sheet?.getRow(2).values as unknown[]).slice(2, 5)).toEqual(['BAYU SAPUTRA', 'XI TKJ 1', 'CV Sentosa']);
    expect((sheet?.getRow(4).values as unknown[]).slice(2, 3)).toEqual(['SINTA DEWI']);
    expect(sheet?.getRow(4).getCell(11).value).toBe('Belum dinilai');
    expect(sheet?.lastRow?.getCell(11).value).toBe(100);
    expect(sheet?.lastRow?.getCell(12).value).toBe('1 dari 3 siswa sudah dinilai');
  });

  it('limits to one DUDI and to the caller’s own students for a guru pembimbing', async () => {
    const sentosa = await sheetOf(w.agents.kepsek, `format=xlsx&partnerId=${w.partners.sentosa}`);
    expect(sentosa?.rowCount).toBe(3); // header, BAYU, mean
    const guru = await sheetOf(w.agents.pembimbing, 'format=xlsx');
    expect(guru?.rowCount).toBe(3); // header, RIZKY, mean
  });

  it('builds the PDF too; the industry supervisor cannot export', async () => {
    const pdf = await fetchFile(w.agents.humas, 'format=pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await fetchFile(mentor.a, 'format=xlsx')).status).toBe(403);
    expect((await fetchFile(w.agents.kepsek, 'format=csv')).status).toBe(400);
  });
});
