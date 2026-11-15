import { ErrorBody, MeContextResponse } from '@absah/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp, enableTotp, signIn, signInWithTotp, testPhone } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

describe('staff login (email + password)', () => {
  it('signs in and reaches /me/context with a session cookie', async () => {
    const school = await t.school('sma', 'SMA Login');
    const guru = await t.staff('Bu Sari');
    await t.member(school, guru.id, 'guru');
    const agent = t.agent();

    const res = await signIn(agent, guru.email);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.toString()).toContain('session_token');

    const me = await agent.get('/api/v1/me/context').expect(200);
    const body = MeContextResponse.parse(me.body);
    expect(body.user.id).toBe(guru.id);
    expect(body.schools).toEqual([expect.objectContaining({ id: school, name: 'SMA Login', roles: ['guru'] })]);
    expect(body.active).toBeNull();
  });

  it('rejects a wrong password', async () => {
    const guru = await t.staff();
    const res = await signIn(t.agent(), guru.email, 'salah-salah-salah');
    expect(res.status).toBe(401);
  });

  it('has no public sign-up', async () => {
    const res = await t
      .agent()
      .post('/api/auth/sign-up/email')
      .send({ name: 'Penyusup', email: 'penyusup@test.local', password: 'kata-sandi-panjang' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('without a session, /me/context is 401 UNAUTHENTICATED', async () => {
    const res = await t.agent().get('/api/v1/me/context').expect(401);
    expect(ErrorBody.parse(res.body).code).toBe('UNAUTHENTICATED');
  });
});

describe('two-factor is mandatory for admin and operator (PLT-01)', () => {
  it('blocks an admin without TOTP, then allows them after enrolling', async () => {
    const school = await t.school('smk', 'SMK 2FA');
    const admin = await t.staff('Pak Admin');
    await t.member(school, admin.id, 'admin');
    const agent = t.agent();
    await signIn(agent, admin.email).expect(200);

    // No school selected: context loads and shows 2FA is off, so the UI can send them to setup.
    const me = MeContextResponse.parse((await agent.get('/api/v1/me/context').expect(200)).body);
    expect(me.user.twoFactorEnabled).toBe(false);

    const blocked = await agent.get('/api/v1/me/context').set('X-School-Id', school).expect(403);
    expect(ErrorBody.parse(blocked.body).code).toBe('TWO_FACTOR_REQUIRED');

    const nextCode = await enableTotp(agent);

    // A fresh sign-in now needs the TOTP step before any session exists.
    const fresh = t.agent();
    expect((await signInWithTotp(fresh, admin.email, nextCode)).status).toBe(200);
    const ok = MeContextResponse.parse(
      (await fresh.get('/api/v1/me/context').set('X-School-Id', school).expect(200)).body,
    );
    expect(ok.active).toEqual({ schoolId: school, roles: ['admin'], capabilities: {} });
  });

  it('does not require TOTP for a guru', async () => {
    const school = await t.school();
    const guru = await t.staff();
    await t.member(school, guru.id, 'guru');
    const agent = t.agent();
    await signIn(agent, guru.email).expect(200);
    await agent.get('/api/v1/me/context').set('X-School-Id', school).expect(200);
  });
});

describe('WhatsApp OTP login for parents', () => {
  it('sends a code to a known number and signs in with it', async () => {
    const school = await t.school('sd', 'SD OTP');
    const parent = await t.parent(testPhone());
    await t.member(school, parent.id, 'orang_tua');
    const agent = t.agent();

    await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber: parent.phoneNumber }).expect(200);
    const code = t.messageSender.lastCodeFor(parent.phoneNumber);
    expect(code).toMatch(/^\d{6}$/);

    await agent.post('/api/auth/phone-number/verify').send({ phoneNumber: parent.phoneNumber, code }).expect(200);
    const me = MeContextResponse.parse((await agent.get('/api/v1/me/context').expect(200)).body);
    expect(me.user).toMatchObject({ id: parent.id, email: null, phoneNumber: parent.phoneNumber });
    expect(me.schools[0]?.roles).toEqual(['orang_tua']);
  });

  it('gives an unknown number the same answer, sends nothing and creates no account', async () => {
    const agent = t.agent();
    const unknown = testPhone();
    await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber: unknown }).expect(200);
    expect(t.messageSender.lastCodeFor(unknown)).toBeUndefined();
    const verify = await agent.post('/api/auth/phone-number/verify').send({ phoneNumber: unknown, code: '000000' });
    expect(verify.status).toBeGreaterThanOrEqual(400);
    expect(verify.status).toBeLessThan(500);
  });

  it('rejects numbers that are not Indonesian E.164', async () => {
    const res = await t.agent().post('/api/auth/phone-number/send-otp').send({ phoneNumber: '081234500001' });
    expect(res.status).toBe(400);
  });
});

describe('rate limit on /api/auth/*', () => {
  it('returns 429 after repeated sign-in attempts from one IP', async () => {
    const guru = await t.staff();
    const agent = t.agent('203.0.113.77');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await signIn(agent, guru.email, 'salah-salah-salah')).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
