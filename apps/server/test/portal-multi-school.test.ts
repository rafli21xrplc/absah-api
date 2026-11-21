import type { MeContextResponse, NotificationPreferences, PortalAttendance, StudentContacts } from '@absah/contracts';
import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { inArray } from 'drizzle-orm';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';

/**
 * ORT-03/04: one parent login, children at different schools. The portal never reads across schools:
 * every call carries X-School-Id, so RLS decides, and the web puts the schools together.
 */
const t = buildTestApp();
const phones: string[] = [];
afterAll(async () => {
  await getDb().db.delete(schema.user).where(inArray(schema.user.phoneNumber, phones));
  await t.cleanup();
});

interface Site {
  school: string;
  wali: Agent;
  child: { id: string; guardianId: string };
  other: { id: string; guardianId: string };
}
const sites: Record<'a' | 'b', Site> = {} as Record<'a' | 'b', Site>;
const parentPhone = testPhone();
const strangerPhone = testPhone();
phones.push(parentPhone, strangerPhone);

const bodyOf = <T>(res: { body: unknown }) => res.body as T;

async function otpLogin(phoneNumber: string) {
  const agent = t.agent();
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
  await agent.post('/api/auth/phone-number/verify').send({ phoneNumber, code: t.messageSender.lastCodeFor(phoneNumber) }).expect(200);
  return agent;
}

async function site(name: string, children: [string, string]): Promise<Site> {
  const school = await t.school('sd', name);
  const staff = await t.staff(`Wali ${name}`);
  await t.member(school, staff.id, 'guru');
  const wali = t.agent();
  await signIn(wali, staff.email).expect(200);
  const made = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '4A', grade: 4, homeroomTeacherId: staff.id }).returning();
    const out = [];
    for (const child of children) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name: child }).returning();
      await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' });
      const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: `Wali ${child}` }).returning();
      await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: s?.id ?? '', guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
      out.push({ id: s?.id ?? '', guardianId: g?.id ?? '' });
    }
    return out;
  });
  return { school, wali, child: made[0] ?? { id: '', guardianId: '' }, other: made[1] ?? { id: '', guardianId: '' } };
}

/** Staff open the portal for one guardian with this number (the same call at every school). */
const linkParent = (s: Site, who: 'child' | 'other', phone: string) =>
  s.wali
    .put(`/api/v1/students/${s[who].id}/contacts`)
    .set('X-School-Id', s.school)
    .set('Idempotency-Key', uuidv7())
    .send({ guardians: [{ guardianId: s[who].guardianId, phone, portal: true }] });

beforeAll(async () => {
  sites.a = await site('SD Kembar A', ['ANDI WIJAYA', 'ANISA PUTRI']);
  sites.b = await site('SD Kembar B', ['BELLA WIJAYA', 'BONO SAPUTRA']);
  // Andi (school A) and Bella (school B) are siblings of one parent; Anisa and Bono belong to a stranger.
  for (const [s, who, phone] of [[sites.a, 'child', parentPhone], [sites.b, 'child', parentPhone], [sites.a, 'other', strangerPhone], [sites.b, 'other', strangerPhone]] as const) {
    bodyOf<StudentContacts>(await linkParent(s, who, phone).expect(200));
  }
});

describe('a parent with children at two schools (ORT-03/04)', () => {
  it('has one login whose context lists both schools as orang tua', async () => {
    const parent = await otpLogin(parentPhone);
    const ctx = bodyOf<MeContextResponse>(await parent.get('/api/v1/me/context').expect(200));
    expect(ctx.schools.map((s) => s.name).sort()).toEqual(['SD Kembar A', 'SD Kembar B']);
    for (const s of ctx.schools) expect(s.roles).toEqual(['orang_tua']);
  });

  it('sees only their own child in each school', async () => {
    const parent = await otpLogin(parentPhone);
    const names = async (school: string) => bodyOf<PortalAttendance>(await parent.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(200)).items.map((i) => i.name);
    expect(await names(sites.a.school)).toEqual(['ANDI WIJAYA']);
    expect(await names(sites.b.school)).toEqual(['BELLA WIJAYA']);
  });

  it('keeps the other family apart in both schools', async () => {
    const stranger = await otpLogin(strangerPhone);
    const names = async (school: string) => bodyOf<PortalAttendance>(await stranger.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(200)).items.map((i) => i.name);
    expect(await names(sites.a.school)).toEqual(['ANISA PUTRI']);
    expect(await names(sites.b.school)).toEqual(['BONO SAPUTRA']);
  });

  it('gets 403 at a school where they have no membership', async () => {
    const outsider = await t.school('sd', 'SD Lain');
    const parent = await otpLogin(parentPhone);
    await parent.get('/api/v1/portal/attendance').set('X-School-Id', outsider).expect(403);
    await parent.get('/api/v1/portal/notification-preferences').set('X-School-Id', outsider).expect(403);
  });

  it('keeps message preferences per school', async () => {
    const parent = await otpLogin(parentPhone);
    const put = (school: string, body: object) => parent.put('/api/v1/portal/notification-preferences').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send(body);
    const read = async (school: string) => bodyOf<NotificationPreferences>(await parent.get('/api/v1/portal/notification-preferences').set('X-School-Id', school).expect(200));
    await put(sites.a.school, { mutedTypes: ['absent_marked'], noLateMessages: true }).expect(200);
    expect(await read(sites.a.school)).toMatchObject({ mutedTypes: ['absent_marked'], noLateMessages: true });
    expect(await read(sites.b.school)).toMatchObject({ mutedTypes: [], noLateMessages: false });
  });
});

describe('a longer, per-child history (ORT-05)', () => {
  const daysAgo = (n: number) => new Date(Date.parse(`${schoolDate('Asia/Jakarta')}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const history = async (agent: Agent, school: string, query = '') => bodyOf<PortalAttendance>(await agent.get(`/api/v1/portal/attendance${query}`).set('X-School-Id', school).expect(200)).items;

  it('reaches back past 30 days only when asked, and names the enrollment', async () => {
    const parent = await otpLogin(parentPhone);
    const [andi] = await history(parent, sites.a.school);
    await withTenant({ schoolId: sites.a.school, userId: null }, (tx) =>
      tx.insert(schema.dailyAttendance).values([
        { schoolId: sites.a.school, enrollmentId: andi?.enrollmentId ?? '', schoolDate: daysAgo(10), status: 'S' },
        { schoolId: sites.a.school, enrollmentId: andi?.enrollmentId ?? '', schoolDate: daysAgo(60), status: 'A' },
      ]),
    );
    expect((await history(parent, sites.a.school))[0]?.days.map((d) => d.status)).toEqual(['S']);
    const long = (await history(parent, sites.a.school, '?days=90'))[0];
    expect(long?.days.map((d) => d.status)).toEqual(['S', 'A']);
    expect(long?.counts).toMatchObject({ S: 1, A: 1 });
    expect(long?.enrollmentId).toBe(andi?.enrollmentId);
  });

  it('narrows to one child, and finds nothing for a child of another family', async () => {
    const stranger = await otpLogin(strangerPhone);
    const parent = await otpLogin(parentPhone);
    expect((await history(parent, sites.a.school, `?studentId=${sites.a.child.id}`)).map((i) => i.name)).toEqual(['ANDI WIJAYA']);
    expect(await history(parent, sites.a.school, `?studentId=${sites.a.other.id}`)).toEqual([]);
    expect((await history(stranger, sites.a.school, `?studentId=${sites.a.other.id}`)).map((i) => i.name)).toEqual(['ANISA PUTRI']);
    // A child of school B asked at school A is not found either.
    expect(await history(parent, sites.a.school, `?studentId=${sites.b.child.id}`)).toEqual([]);
  });

  it('refuses a range beyond 180 days or a malformed query', async () => {
    const parent = await otpLogin(parentPhone);
    for (const q of ['?days=181', '?days=0', '?days=abc', '?studentId=nope']) {
      await parent.get(`/api/v1/portal/attendance${q}`).set('X-School-Id', sites.a.school).expect(400);
    }
  });
});
