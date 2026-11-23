import type { PklAssessmentAspectList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let sma: string;
const agents: Record<string, Agent> = {};
const A = (label: string) => agents[label] as Agent;
const put = (agent: Agent, items: object[], s = school) => agent.put('/api/v1/pkl/assessment-aspects').set('X-School-Id', s).set('Idempotency-Key', uuidv7()).send({ items });
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;
const list = async (agent: Agent, s = school) => ((await agent.get('/api/v1/pkl/assessment-aspects').set('X-School-Id', s).expect(200)).body as PklAssessmentAspectList).items;

beforeAll(async () => {
  [school, sma] = [await t.school('smk', 'SMK Aspek Penilaian'), await t.school('sma', 'SMA Tanpa PKL')];
  for (const [label, role] of [['humas', 'humas_pkl'], ['kepsek', 'kepsek'], ['industri', 'pembimbing_industri'], ['uks', 'petugas_uks']] as const) {
    const u = await t.staff(`Aspek ${label}`);
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(A(label), u.email).expect(200);
  }
});

describe('PKL assessment aspects (PKL-04)', () => {
  it('starts empty; the humas sets the form in order and every PKL reader sees it', async () => {
    expect(await list(A('humas'))).toEqual([]);
    const saved = (await put(A('humas'), [{ name: 'Disiplin', weight: 2 }, { name: 'Kerja sama', description: 'Dalam tim', weight: 1 }, { name: 'Keterampilan teknis', weight: 3 }]).expect(200)).body as PklAssessmentAspectList;
    expect(saved.items.map((i) => [i.name, i.weight, i.description])).toEqual([['Disiplin', 2, null], ['Kerja sama', 1, 'Dalam tim'], ['Keterampilan teknis', 3, null]]);
    for (const label of ['kepsek', 'industri']) expect((await list(A(label))).map((i) => i.name)).toEqual(['Disiplin', 'Kerja sama', 'Keterampilan teknis']);
  });

  it('edits and reorders by id, adds and retires; names may swap', async () => {
    const [disiplin, kerja, teknis] = await list(A('humas'));
    const out = (await put(A('humas'), [
      { id: teknis?.id, name: 'Kerja sama', weight: 3 }, // takes the name of an aspect that moves on
      { id: kerja?.id, name: 'Keterampilan teknis', weight: 1 },
      { name: 'Inisiatif', weight: 1 },
    ]).expect(200)).body as PklAssessmentAspectList;
    expect(out.items.map((i) => [i.name, i.weight])).toEqual([['Kerja sama', 3], ['Keterampilan teknis', 1], ['Inisiatif', 1]]);
    expect(out.items[0]?.id).toBe(teknis?.id);
    // Disiplin was left out: retired, not deleted (an assessment may still point at it).
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.pklAssessmentAspects).where(and(eq(schema.pklAssessmentAspects.id, disiplin?.id ?? ''))));
    expect(row).toMatchObject({ name: 'Disiplin', active: false });
    // The retired name is free again.
    expect(((await put(A('humas'), [...out.items, { name: 'disiplin', weight: 2 }]).expect(200)).body as PklAssessmentAspectList).items.at(-1)?.name).toBe('disiplin');
  });

  it('refuses a repeated name, an unknown id, an empty list and too many aspects', async () => {
    expect(codeOf(await put(A('humas'), [{ name: 'Sopan', weight: 1 }, { name: 'sopan ', weight: 1 }]).expect(400))).toBe('VALIDATION_FAILED');
    await put(A('humas'), [{ id: uuidv7(), name: 'Hantu', weight: 1 }]).expect(400);
    await put(A('humas'), []).expect(400);
    await put(A('humas'), Array.from({ length: 13 }, (_, i) => ({ name: `Aspek ${i}`, weight: 1 }))).expect(400);
    await put(A('humas'), [{ name: 'Terlalu berat', weight: 11 }]).expect(400);
    expect((await list(A('humas'))).length).toBe(4); // nothing changed
  });

  it('only managers write; staff outside PKL cannot read; a school without PKL has no such route', async () => {
    await put(A('kepsek'), [{ name: 'Rapi', weight: 1 }]).expect(403);
    await put(A('industri'), [{ name: 'Rapi', weight: 1 }]).expect(403);
    await A('uks').get('/api/v1/pkl/assessment-aspects').set('X-School-Id', school).expect(403);
    const outsider = await t.staff('Kepsek SMA');
    await t.member(sma, outsider.id, 'kepsek');
    const agent = t.agent();
    await signIn(agent, outsider.email).expect(200);
    expect(codeOf(await agent.get('/api/v1/pkl/assessment-aspects').set('X-School-Id', sma).expect(404))).toBe('CAPABILITY_DISABLED');
  });
});
