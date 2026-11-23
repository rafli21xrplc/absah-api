import { ErrorBody, SchoolMembersResponse } from '@absah/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let schoolA: string;
let schoolB: string;
let admin: Agent;
let guru: Agent;
let outsider: Agent;
let suspended: Agent;

beforeAll(async () => {
  schoolA = await t.school('sma', 'SMA A');
  schoolB = await t.school('smp', 'SMP B');

  const a = await t.staff('Admin A');
  await t.member(schoolA, a.id, 'admin');
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);

  const g = await t.staff('Guru A');
  await t.member(schoolA, g.id, 'guru');
  await t.member(schoolA, g.id, 'wali_kelas');
  await t.member(schoolB, g.id, 'guru');
  guru = t.agent();
  await signIn(guru, g.email).expect(200);

  const o = await t.staff('Orang luar');
  await t.member(schoolB, o.id, 'admin', 'invited');
  outsider = t.agent();
  await signIn(outsider, o.email).expect(200);

  const s = await t.staff('Diskors');
  await t.member(schoolA, s.id, 'guru', 'suspended');
  suspended = t.agent();
  await signIn(suspended, s.email).expect(200);
});

describe('X-School-Id and memberships', () => {
  it('lists every school with all roles, and roles only for the active school', async () => {
    const res = await guru.get('/api/v1/me/context').set('X-School-Id', schoolA).expect(200);
    const body = res.body as { schools: { id: string; roles: string[] }[]; active: { roles: string[] } };
    expect(body.schools.map((s) => s.id).sort()).toEqual([schoolA, schoolB].sort());
    expect(body.active.roles.sort()).toEqual(['guru', 'wali_kelas']);
  });

  it('rejects a school the user does not belong to with 403', async () => {
    const res = await outsider.get('/api/v1/me/context').set('X-School-Id', schoolA).expect(403);
    expect(ErrorBody.parse(res.body).code).toBe('FORBIDDEN');
  });

  it('treats invited and suspended memberships as no membership', async () => {
    await outsider.get('/api/v1/me/context').set('X-School-Id', schoolB).expect(403);
    await suspended.get('/api/v1/me/context').set('X-School-Id', schoolA).expect(403);
    const me = (await suspended.get('/api/v1/me/context').expect(200)).body as { schools: unknown[] };
    expect(me.schools).toEqual([]);
  });

  it('gives a non-existent school the same 403 as a foreign one', async () => {
    const res = await guru.get('/api/v1/me/context').set('X-School-Id', '0190a2b4-0000-7000-8000-00000000dead');
    expect(res.status).toBe(403);
  });

  it('rejects a malformed X-School-Id with 400', async () => {
    const res = await guru.get('/api/v1/me/context').set('X-School-Id', 'abc').expect(400);
    expect(ErrorBody.parse(res.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /school/members (authorize per use case)', () => {
  it('lets an admin list members of their own school only', async () => {
    const res = await admin.get('/api/v1/school/members').set('X-School-Id', schoolA).expect(200);
    const { items } = SchoolMembersResponse.parse(res.body);
    expect(new Set(items.map((m) => m.name))).toEqual(new Set(['Admin A', 'Guru A', 'Diskors']));
    expect(items.find((m) => m.name === 'Diskors')?.status).toBe('suspended');
  });

  it('rejects the wrong role with 403', async () => {
    const res = await guru.get('/api/v1/school/members').set('X-School-Id', schoolA).expect(403);
    expect(ErrorBody.parse(res.body).code).toBe('FORBIDDEN');
  });

  it('requires X-School-Id', async () => {
    const res = await admin.get('/api/v1/school/members').expect(400);
    expect(ErrorBody.parse(res.body).code).toBe('VALIDATION_FAILED');
  });

  it('requires a session', async () => {
    await t.agent().get('/api/v1/school/members').set('X-School-Id', schoolA).expect(401);
  });
});
