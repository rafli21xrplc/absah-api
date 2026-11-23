import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let admin: Agent;
let guru: Agent;
let adminId: string;
let guruId: string;

beforeAll(async () => {
  const a = await t.staff('Admin Pengaturan');
  adminId = a.id;
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  const g = await t.staff('Guru Pengaturan');
  guruId = g.id;
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
});

async function newSchool(level: 'sd' | 'sma' = 'sma') {
  const id = await t.school(level, 'Sekolah Pengaturan');
  await t.member(id, adminId, 'admin');
  await t.member(id, guruId, 'guru');
  return id;
}

type Setting = { key: string; effective: unknown; override: unknown; pending: unknown; preset: unknown };
const key = () => `settings-${uuidv7()}`;
const put = (school: string, values: Record<string, unknown>, idem = key()) =>
  admin.put('/api/v1/school/capabilities').set('X-School-Id', school).set('Idempotency-Key', idem).send({ values });
const patchProfile = (school: string, body: object) =>
  admin.patch('/api/v1/school/profile').set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const setting = (body: unknown, k: string) => (body as { items: Setting[] }).items.find((i) => i.key === k);
const meCaps = async (school: string) =>
  ((await guru.get('/api/v1/me/context').set('X-School-Id', school).expect(200)).body as {
    active: { capabilities: Record<string, unknown> };
  }).active.capabilities;
const tomorrow = () => addDays(schoolDate('Asia/Jakarta'), 1);

describe('GET /school/capabilities', () => {
  it('lists every catalog key with preset and effective value, for admins only', async () => {
    const school = await newSchool('sd');
    const res = await admin.get('/api/v1/school/capabilities').set('X-School-Id', school).expect(200);
    expect(setting(res.body, 'attendance.mode')).toMatchObject({
      kind: 'enum',
      options: ['per_period', 'daily'],
      preset: 'daily',
      override: null,
      pending: null,
      killSwitch: null,
      deferred: true,
      effective: 'daily',
    });
    await guru.get('/api/v1/school/capabilities').set('X-School-Id', school).expect(403);
  });
});

describe('PUT /school/capabilities', () => {
  it('overrides and resets immediate capabilities, audited, visible in /me/context', async () => {
    const school = await newSchool();
    const res = await put(school, { 'mbg.enabled': true, 'gate.visitors': false }).expect(200);
    expect(setting(res.body, 'mbg.enabled')).toMatchObject({ override: true, effective: true, preset: false });
    expect(await meCaps(school)).toMatchObject({ 'mbg.enabled': true, 'gate.visitors': false });

    const reset = await put(school, { 'gate.visitors': null }).expect(200);
    expect(setting(reset.body, 'gate.visitors')).toMatchObject({ override: null, effective: true });

    const logs = await getDb()
      .db.select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'school.capabilities_updated')));
    expect(logs).toHaveLength(2);
  });

  it('validates keys against the catalog and values against their kind', async () => {
    const school = await newSchool();
    const res = await put(school, { 'nope.key': true, 'gate.pickup': 'ya', 'attendance.mode': 'weekly' }).expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const paths = (res.body as { details: { path: string }[] }).details.map((d) => d.path).sort();
    expect(paths).toEqual(['values.attendance.mode', 'values.gate.pickup', 'values.nope.key']);
    await put(school, {}).expect(400);
    await put(school, { 'gate.pickup': [true] }).expect(400);
  });

  it('defers attendance.mode to tomorrow and can cancel it', async () => {
    const school = await newSchool();
    const res = await put(school, { 'attendance.mode': 'daily' }).expect(200);
    expect(setting(res.body, 'attendance.mode')).toMatchObject({
      effective: 'per_period',
      pending: { value: 'daily', effectiveFrom: tomorrow() },
    });
    expect((await meCaps(school))['attendance.mode']).toBe('per_period');

    // A day later (simulated by moving the date): the new mode is in force.
    const row = and(eq(schema.schoolCapabilities.schoolId, school), eq(schema.schoolCapabilities.key, 'attendance.mode'));
    await getDb().db.update(schema.schoolCapabilities).set({ effectiveFrom: schoolDate('Asia/Jakarta') }).where(row);
    expect((await meCaps(school))['attendance.mode']).toBe('daily');

    await getDb().db.update(schema.schoolCapabilities).set({ effectiveFrom: tomorrow() }).where(row);
    const cancelled = await put(school, { 'attendance.mode': 'per_period' }).expect(200);
    expect(setting(cancelled.body, 'attendance.mode')).toMatchObject({ pending: null, effective: 'per_period' });
  });

  it('refuses keys under a kill switch with 409', async () => {
    const school = await newSchool();
    const [flag] = await getDb()
      .db.insert(schema.platformFlags)
      .values({ key: 'pkl.enabled', value: false, schoolId: school, reason: 'test' })
      .returning({ id: schema.platformFlags.id });
    const res = await put(school, { 'pkl.enabled': true, 'mbg.enabled': true }).expect(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', details: { keys: ['pkl.enabled'] } });
    const list = await admin.get('/api/v1/school/capabilities').set('X-School-Id', school).expect(200);
    expect(setting(list.body, 'pkl.enabled')).toMatchObject({ killSwitch: false, effective: false });
    expect(setting(list.body, 'mbg.enabled')).toMatchObject({ override: null }); // nothing applied
    if (flag) await getDb().db.delete(schema.platformFlags).where(eq(schema.platformFlags.id, flag.id));
  });

  it('is idempotent and admin only', async () => {
    const school = await newSchool();
    const idem = key();
    await put(school, { 'mbg.enabled': true }, idem).expect(200);
    const replay = await put(school, { 'mbg.enabled': true }, idem).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await put(school, { 'mbg.enabled': false }, idem).expect(422);
    await guru
      .put('/api/v1/school/capabilities')
      .set('X-School-Id', school)
      .set('Idempotency-Key', key())
      .send({ values: { 'mbg.enabled': false } })
      .expect(403);
  });
});

describe('PATCH /school/profile', () => {
  it('re-applies presets, keeps overrides and pins attendance.mode until tomorrow', async () => {
    const school = await newSchool('sma');
    await put(school, { 'mbg.enabled': true }).expect(200);

    const res = await patchProfile(school, { level: 'sd', isMadrasah: true }).expect(200);
    expect(res.body).toMatchObject({ level: 'sd', isMadrasah: true });
    expect((res.body as { capabilities: Record<string, unknown> }).capabilities).toMatchObject({
      'gate.pickup': true, // sd preset, immediately
      'data.source': 'emis', // madrasah overlay
      'mbg.enabled': true, // school override kept
      'attendance.mode': 'per_period', // daily only from tomorrow
    });
    const list = await admin.get('/api/v1/school/capabilities').set('X-School-Id', school).expect(200);
    expect(setting(list.body, 'attendance.mode')).toMatchObject({
      preset: 'daily',
      effective: 'per_period',
      pending: { value: null, effectiveFrom: tomorrow() },
    });

    const [log] = await getDb()
      .db.select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'school.profile_updated')));
    expect(log?.before).toEqual({ level: 'sma', isMadrasah: false });
  });

  it('switches attendance.mode only through the preset when nothing else pins it', async () => {
    const school = await newSchool('sd');
    await patchProfile(school, { isMadrasah: true }).expect(200);
    expect((await meCaps(school))['attendance.mode']).toBe('daily'); // unchanged, no pin needed
  });

  it('validates the body and is admin only', async () => {
    const school = await newSchool();
    await patchProfile(school, {}).expect(400);
    await patchProfile(school, { level: 'mi' }).expect(400);
    await patchProfile(school, { level: 'sd', extra: 1 }).expect(400);
    await guru
      .patch('/api/v1/school/profile')
      .set('X-School-Id', school)
      .set('Idempotency-Key', key())
      .send({ level: 'sd' })
      .expect(403);
  });
});

describe('school identity in PATCH /school/profile', () => {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

  it('updates name, NPSN/NSM and timezone, audited with only the changed fields', async () => {
    const school = await newSchool();
    const npsn = digits(8);
    const res = await patchProfile(school, { name: '  SMA Negeri Uji  ', npsn, timezone: 'Asia/Makassar' }).expect(200);
    expect(res.body).toMatchObject({ name: 'SMA Negeri Uji', npsn, nsm: null, timezone: 'Asia/Makassar', level: 'sma' });

    const cleared = await patchProfile(school, { npsn: null }).expect(200);
    expect(cleared.body).toMatchObject({ npsn: null });

    const logs = await getDb()
      .db.select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'school.profile_updated')));
    expect(logs.map((l) => Object.keys(l.after as object).sort())).toEqual([['name', 'npsn', 'timezone'], ['npsn']]);
  });

  it('rejects malformed identifiers and NPSN used by another school', async () => {
    const a = await newSchool();
    const b = await newSchool();
    const npsn = digits(8);
    await patchProfile(a, { npsn }).expect(200);
    const taken = await patchProfile(b, { npsn }).expect(409);
    expect(taken.body).toMatchObject({ code: 'CONFLICT', message: 'NPSN sudah dipakai sekolah lain.' });
    await patchProfile(b, { npsn: '1234' }).expect(400);
    await patchProfile(b, { nsm: digits(8) }).expect(400);
    await patchProfile(b, { timezone: 'Europe/Berlin' }).expect(400);
    await patchProfile(b, { name: 'X' }).expect(400);
  });
});

describe('setup wizard progress', () => {
  const setupGet = (school: string) => admin.get('/api/v1/school/setup').set('X-School-Id', school);
  const mark = (school: string, step: string, status: string) =>
    admin.put(`/api/v1/school/setup/steps/${step}`).set('X-School-Id', school).send({ status });
  const complete = (school: string) => admin.post('/api/v1/school/setup/complete').set('X-School-Id', school);

  it('starts with every step todo and the current profile', async () => {
    const school = await newSchool('sd');
    const res = await setupGet(school).expect(200);
    expect(res.body).toMatchObject({
      completedAt: null,
      profile: { level: 'sd', isMadrasah: false, timezone: 'Asia/Jakarta' },
    });
    expect((res.body as { steps: { status: string }[] }).steps.map((s) => s.status)).toEqual(Array(6).fill('todo'));
  });

  it('keeps progress, refuses to skip required steps and finishes once', async () => {
    const school = await newSchool();
    await mark(school, 'profile', 'done').expect(200);
    await mark(school, 'level', 'skipped').expect(400);
    await mark(school, 'mbg', 'skipped').expect(200);
    await mark(school, 'nope', 'done').expect(400);

    const early = await complete(school).expect(409);
    expect(early.body).toMatchObject({ code: 'CONFLICT', details: { steps: ['level'] } });

    await mark(school, 'level', 'done').expect(200);
    const done = await complete(school).expect(200);
    const again = await complete(school).expect(200);
    expect((done.body as { completedAt: string }).completedAt).not.toBeNull();
    expect((again.body as { completedAt: string }).completedAt).toBe((done.body as { completedAt: string }).completedAt);

    const res = await setupGet(school).expect(200);
    expect((res.body as { steps: { id: string; status: string }[] }).steps).toEqual([
      { id: 'profile', status: 'done' },
      { id: 'level', status: 'done' },
      { id: 'mbg', status: 'skipped' },
      { id: 'import', status: 'todo' },
      { id: 'gate', status: 'todo' },
      { id: 'invite', status: 'todo' },
    ]);
  });

  it('is admin only', async () => {
    const school = await newSchool();
    await guru.get('/api/v1/school/setup').set('X-School-Id', school).expect(403);
    await guru.put('/api/v1/school/setup/steps/profile').set('X-School-Id', school).send({ status: 'done' }).expect(403);
  });
});
