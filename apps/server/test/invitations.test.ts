import { schema } from '@absah/db';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchoolWithAdmin } from '../src/modules/platform';
import { getDb } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, TEST_ORIGIN, testPhone, type Agent } from './harness';

const t = buildTestApp();
const invitedEmails: string[] = [];
const invitedPhones: string[] = [];
const extraSchools: string[] = [];

afterAll(async () => {
  const { db } = getDb();
  if (extraSchools.length) await db.delete(schema.schools).where(inArray(schema.schools.id, extraSchools));
  if (invitedEmails.length) await db.delete(schema.user).where(inArray(schema.user.email, invitedEmails));
  if (invitedPhones.length) await db.delete(schema.user).where(inArray(schema.user.phoneNumber, invitedPhones));
  await t.cleanup();
});

let school: string;
let admin: Agent;
let guru: Agent;

beforeAll(async () => {
  school = await t.school('smp', 'SMP Undangan');
  const a = await t.staff('Admin Undangan');
  await t.member(school, a.id, 'admin');
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  const g = await t.staff('Guru Undangan');
  await t.member(school, g.id, 'guru');
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
});

const newEmail = () => {
  const email = `undangan-${uuidv7()}@test.local`;
  invitedEmails.push(email);
  return email;
};
const newPhone = () => {
  const phone = testPhone();
  invitedPhones.push(phone);
  return phone;
};
const invite = (body: object, agent = admin, idem = `inv-${uuidv7()}`) =>
  agent.post('/api/v1/school/invitations').set('X-School-Id', school).set('Idempotency-Key', idem).send(body);
const tokenOf = (res: { body: unknown }) => (res.body as { inviteUrl: string }).inviteUrl.split('#')[1] ?? '';
const preview = (token: string) => t.agent().post('/api/v1/invitations/preview').send({ token });
const accept = (body: object) => t.agent().post('/api/v1/invitations/accept').send(body);
const membership = (id: string) =>
  getDb().db.select().from(schema.memberships).where(eq(schema.memberships.id, id)).then((r) => r[0]);

describe('inviting staff by email', () => {
  it('creates an invited membership, a one-time link, an audit entry and an event', async () => {
    const email = newEmail();
    const res = await invite({ name: 'Pak Budi', email, role: 'wali_kelas' }).expect(201);
    const body = res.body as { membershipId: string; inviteUrl: string; expiresAt: string };
    expect(body.inviteUrl).toMatch(new RegExp(`^${TEST_ORIGIN}/undangan#${school}\\.[\\w-]{43}$`));
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(await membership(body.membershipId)).toMatchObject({ status: 'invited', role: 'wali_kelas' });

    const { db } = getDb();
    const stored = await db.select().from(schema.invitations).where(eq(schema.invitations.membershipId, body.membershipId));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toContain(tokenOf(res).split('.')[1]); // only an HMAC is stored
    const [log] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.entityId, body.membershipId)));
    expect(log).toMatchObject({ action: 'membership.invited', after: { role: 'wali_kelas', channel: 'email' } });
    expect(JSON.stringify(log)).not.toContain(email);
    const events = await db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.schoolId, school));
    expect(events.some((e) => e.type === 'membership.invited')).toBe(true);
  });

  it('lets the invitee choose a password, then log in to the school', async () => {
    const email = newEmail();
    const res = await invite({ name: 'Bu Sari', email, role: 'guru' }).expect(201);
    const token = tokenOf(res);
    await signIn(t.agent(), email, 'kata-sandi-baru-123').expect(401); // no password yet

    expect((await preview(token).expect(200)).body).toEqual({
      schoolName: 'SMP Undangan',
      role: 'guru',
      name: 'Bu Sari',
      loginMethod: 'password',
      needsPassword: true,
    });
    const missing = await accept({ token }).expect(400);
    expect(missing.body).toMatchObject({ details: [{ path: 'password' }] });
    await accept({ token, password: 'pendek' }).expect(400);
    expect((await accept({ token, password: 'kata-sandi-baru-123' }).expect(200)).body).toEqual({
      schoolId: school,
      schoolName: 'SMP Undangan',
      loginMethod: 'password',
    });

    await accept({ token, password: 'kata-sandi-baru-123' }).expect(404); // single use
    await preview(token).expect(404);
    const invitee = t.agent();
    await signIn(invitee, email, 'kata-sandi-baru-123').expect(200);
    const ctx = await invitee.get('/api/v1/me/context').set('X-School-Id', school).expect(200);
    expect(ctx.body).toMatchObject({ active: { roles: ['guru'] } });
  });

  it('reuses an existing account, which keeps its own password', async () => {
    const other = await t.staff('Guru Dua Sekolah');
    const res = await invite({ name: 'Nama Lain', email: other.email, role: 'piket' }).expect(201);
    const token = tokenOf(res);
    expect((await preview(token).expect(200)).body).toMatchObject({ name: 'Guru Dua Sekolah', needsPassword: false });
    await accept({ token }).expect(200);
    const agent = t.agent();
    await signIn(agent, other.email).expect(200);
    await agent.get('/api/v1/me/context').set('X-School-Id', school).expect(200);
  });

  it('re-issuing a pending invitation invalidates the old link', async () => {
    const email = newEmail();
    const first = await invite({ name: 'Pak Dedi', email, role: 'guru' }).expect(201);
    const second = await invite({ name: 'Pak Dedi', email, role: 'guru' }).expect(201);
    expect((second.body as { membershipId: string }).membershipId).toBe((first.body as { membershipId: string }).membershipId);
    await preview(tokenOf(first)).expect(404);
    await preview(tokenOf(second)).expect(200);
  });

  it('refuses members who are already active or suspended in that role', async () => {
    const u = await t.staff('Sudah Anggota');
    await t.member(school, u.id, 'guru');
    await invite({ name: 'Xy', email: u.email, role: 'guru' }).expect(409);
    await t.member(school, u.id, 'piket', 'suspended');
    await invite({ name: 'Xy', email: u.email, role: 'piket' }).expect(409);
    await invite({ name: 'Xy', email: u.email, role: 'wakasek' }).expect(201); // other role is fine
  });
});

describe('inviting staff by WhatsApp', () => {
  it('accepts without a password, then logs in with an OTP', async () => {
    const phoneNumber = newPhone();
    const res = await invite({ name: 'Pak Satpam', phoneNumber, role: 'piket' }).expect(201);
    const token = tokenOf(res);
    expect((await preview(token).expect(200)).body).toMatchObject({ loginMethod: 'otp', needsPassword: false });
    await accept({ token, password: 'diabaikan-saja-123' }).expect(200);

    const agent = t.agent();
    await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
    const code = t.messageSender.lastCodeFor(phoneNumber);
    await agent.post('/api/auth/phone-number/verify').send({ phoneNumber, code }).expect(200);
    await agent.get('/api/v1/me/context').set('X-School-Id', school).expect(200);
  });
});

describe('validation, roles and idempotency', () => {
  it('needs exactly one of email and phone, and a staff role', async () => {
    await invite({ name: 'X Y', role: 'guru' }).expect(400);
    await invite({ name: 'X Y', email: newEmail(), phoneNumber: newPhone(), role: 'guru' }).expect(400);
    await invite({ name: 'X Y', email: newEmail(), role: 'orang_tua' }).expect(400);
    await invite({ name: 'X Y', phoneNumber: '081234567890', role: 'guru' }).expect(400);
  });

  it('is admin only', async () => {
    await invite({ name: 'X Y', email: newEmail(), role: 'guru' }, guru).expect(403);
  });

  it('replays the same link for a retried request', async () => {
    const idem = `inv-${uuidv7()}`;
    const body = { name: 'Bu Retry', email: newEmail(), role: 'guru' };
    const first = await invite(body, admin, idem).expect(201);
    const retry = await invite(body, admin, idem).expect(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    await preview(tokenOf(first)).expect(200);
  });

  it('answers 404 for malformed, unknown and expired tokens alike', async () => {
    await preview('x'.repeat(50)).expect(404);
    await preview(`${school}.${'A'.repeat(43)}`).expect(404);
    await preview(`${uuidv7()}.${'A'.repeat(43)}`).expect(404);
    const res = await invite({ name: 'Bu Lama', email: newEmail(), role: 'guru' }).expect(201);
    await getDb()
      .db.update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitations.membershipId, (res.body as { membershipId: string }).membershipId));
    const expired = await accept({ token: tokenOf(res), password: 'kata-sandi-baru-123' }).expect(404);
    expect(expired.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('createSchoolWithAdmin (ops)', () => {
  it('creates the school and an admin invitation that leads to the setup wizard', async () => {
    const email = newEmail();
    const created = await createSchoolWithAdmin(t.auth, { schoolName: 'SD Ops Baru', level: 'sd', adminName: 'Bu Kepala', adminEmail: email }, TEST_ORIGIN);
    extraSchools.push(created.schoolId);
    const token = created.inviteUrl.split('#')[1] ?? '';
    expect((await preview(token).expect(200)).body).toMatchObject({ schoolName: 'SD Ops Baru', role: 'admin', needsPassword: true });
    await accept({ token, password: 'kata-sandi-admin-123' }).expect(200);

    const newAdmin = t.agent();
    await signIn(newAdmin, email, 'kata-sandi-admin-123').expect(200);
    await newAdmin.get('/api/v1/school/setup').set('X-School-Id', created.schoolId).expect(403); // TOTP first
    await enableTotp(newAdmin, 'kata-sandi-admin-123');
    const setup = await newAdmin.get('/api/v1/school/setup').set('X-School-Id', created.schoolId).expect(200);
    expect(setup.body).toMatchObject({ completedAt: null, profile: { name: 'SD Ops Baru', level: 'sd' } });
  });
});
