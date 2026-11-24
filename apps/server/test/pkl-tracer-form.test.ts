import type { TracerAlumnus, TracerFormContext } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { mintTracerLink } from '../src/shared/tracer-links';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let sma: string;
let humas: Agent;
let alumnusId: string;
const APP = 'https://app.absah.test';

const tokenOf = (url: string) => url.split('#')[1] ?? '';
const mint = (s: string, id: string, now?: Date) => withTenant({ schoolId: s, userId: null }, async (tx) => tokenOf(await mintTracerLink(tx, { schoolId: s, alumnusId: id, appUrl: APP, ...(now ? { now } : {}) })));
const form = (agent: Agent, method: 'get' | 'put', token: string, body?: object) => {
  const req = agent[method]('/api/v1/tracer/form').set('Authorization', `Tracer ${token}`);
  return body ? req.send(body) : req;
};

beforeAll(async () => {
  [school, sma] = [await t.school('smk', 'SMK Tautan Alumni'), await t.school('sma', 'SMA Tautan Alumni')];
  const u = await t.staff('Humas Tautan');
  await t.member(school, u.id, 'humas_pkl');
  humas = t.agent();
  await signIn(humas, u.email).expect(200);
  const res = await humas.post('/api/v1/tracer/alumni').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ name: 'Rina Maharani Putri', graduationYear: 2026, stream: 'ips' }).expect(201);
  alumnusId = (res.body as TracerAlumnus).id;
});

describe('Tracer study link for alumni (PKL-05)', () => {
  it('opens with the first name only and no answer yet; the page needs no session', async () => {
    const token = await mint(school, alumnusId);
    expect(token.startsWith(`${school}.`)).toBe(true);
    const res = await form(t.agent(), 'get', token).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ schoolName: 'SMK Tautan Alumni', firstName: 'Rina', graduationYear: 2026, response: null });
    expect(JSON.stringify(res.body)).not.toContain('Maharani');
  });

  it('the alumnus answers (source alumni, visible to the BKK) and may change the answer until the link expires', async () => {
    const token = await mint(school, alumnusId);
    const first = (await form(t.agent(), 'put', token, { status: 'bekerja', organization: 'PT Maju Jaya', position: 'Admin' }).expect(200)).body as TracerFormContext;
    expect(first.response).toMatchObject({ status: 'bekerja', organization: 'PT Maju Jaya', position: 'Admin' });

    const shown = (await humas.get('/api/v1/tracer/alumni').set('X-School-Id', school).expect(200)).body as { items: TracerAlumnus[] };
    expect(shown.items[0]?.response).toMatchObject({ status: 'bekerja', source: 'alumni' });

    const second = (await form(t.agent(), 'put', token, { status: 'melanjutkan', organization: 'Universitas Negeri', position: 'Akuntansi' }).expect(200)).body as TracerFormContext;
    expect(second.response).toMatchObject({ status: 'melanjutkan', organization: 'Universitas Negeri' });
    // Opening it again shows the answer.
    expect(((await form(t.agent(), 'get', token).expect(200)).body as TracerFormContext).response?.status).toBe('melanjutkan');

    const rows = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.tracerResponses).where(eq(schema.tracerResponses.alumnusId, alumnusId)));
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ source: 'alumni', enteredBy: null });
  });

  it('refuses an answer without the name of the company, campus or business, and drops it for "belum"', async () => {
    const token = await mint(school, alumnusId);
    await form(t.agent(), 'put', token, { status: 'wirausaha' }).expect(400);
    const out = (await form(t.agent(), 'put', token, { status: 'belum', organization: 'diabaikan' }).expect(200)).body as TracerFormContext;
    expect(out.response).toMatchObject({ status: 'belum', organization: null, position: null });
  });

  it('answers 401 for a missing, malformed or unknown token, and 410 once it is past 30 days', async () => {
    await t.agent().get('/api/v1/tracer/form').expect(401);
    await form(t.agent(), 'get', 'bukan-token').expect(401);
    await form(t.agent(), 'get', `${school}.${'a'.repeat(43)}`).expect(401);
    await t.agent().get('/api/v1/tracer/form').set('Authorization', `Link ${await mint(school, alumnusId)}`).expect(401);
    const old = await mint(school, alumnusId, new Date(Date.now() - 31 * 86_400_000));
    await form(t.agent(), 'get', old).expect(410);
    await form(t.agent(), 'put', old, { status: 'belum' }).expect(410);
  });

  it('a token of another school does not open this one, and a school without the tracer study answers 404', async () => {
    const token = await mint(school, alumnusId);
    // The school id in front picks the tenant: swapping it finds no such link there.
    await form(t.agent(), 'get', `${sma}.${token.split('.')[1]}`).expect(401);
    // Switched off by the school: the link stops working.
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'pkl.tracer', value: false }));
    expect(((await form(t.agent(), 'get', token).expect(404)).body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.schoolCapabilities).where(eq(schema.schoolCapabilities.schoolId, school)));
    await form(t.agent(), 'get', token).expect(200);
  });
});
