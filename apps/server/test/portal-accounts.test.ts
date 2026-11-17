import type { PortalAttendance, StudentContacts } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
/** Logins created through the endpoint (the harness only tracks its own users). */
const phones: string[] = [];
afterAll(async () => {
  await getDb().db.delete(schema.user).where(inArray(schema.user.phoneNumber, phones));
  await t.cleanup();
});

const today = schoolDate('Asia/Jakarta');
const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
let school: string;
let wali: Agent;
let otherGuru: Agent;
let admin: Agent;
const students: Record<string, { id: string; enrollment: string }> = {};
let guardianId: string;

const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const contacts = (agent: Agent, studentId: string) => agent.get(`/api/v1/students/${studentId}/contacts`).set('X-School-Id', school);
const put = (agent: Agent, studentId: string, body: object) =>
  agent.put(`/api/v1/students/${studentId}/contacts`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send(body);

/** OTP login as the PWA does it; the fake sender holds the code. */
async function otpLogin(phoneNumber: string) {
  const agent = t.agent();
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
  const code = t.messageSender.lastCodeFor(phoneNumber);
  await agent.post('/api/auth/phone-number/verify').send({ phoneNumber, code }).expect(200);
  return agent;
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Portal');
  const w = await t.staff('Bu Wali Portal');
  const g = await t.staff('Pak Guru Portal');
  const a = await t.staff('Admin Portal');
  await t.member(school, w.id, 'guru');
  await t.member(school, g.id, 'guru');
  await t.member(school, a.id, 'admin');
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  otherGuru = t.agent();
  await signIn(otherGuru, g.email).expect(200);
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8A', grade: 8, homeroomTeacherId: w.id }).returning();
    for (const name of ['BAYU SAPUTRA', 'CITRA DEWI']) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
      students[name] = { id: s?.id ?? '', enrollment: e?.id ?? '' };
    }
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Bayu' }).returning();
    guardianId = guardian?.id ?? '';
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: students['BAYU SAPUTRA']?.id ?? '', guardianId, relation: 'ibu', isPrimary: true });
    const bayu = students['BAYU SAPUTRA']?.enrollment ?? '';
    await tx.insert(schema.dailyAttendance).values(
      (['H', 'H', 'S', 'A'] as const).map((status, i) => ({ schoolId: school, enrollmentId: bayu, schoolDate: daysAgo(i + 1), status })),
    );
  });
});

describe('student contacts and portal logins (ORT-02)', () => {
  const bayu = () => students['BAYU SAPUTRA']?.id ?? '';
  const studentPhone = testPhone();
  const parentPhone = testPhone();
  phones.push(studentPhone);

  it('lets the wali kelas and admin manage numbers, not other teachers', async () => {
    await contacts(otherGuru, bayu()).expect(404);
    await put(otherGuru, bayu(), { studentPhone }).expect(404);
    const empty = bodyOf<StudentContacts>(await contacts(wali, bayu()).expect(200));
    expect(empty).toMatchObject({ name: 'BAYU SAPUTRA', className: '8A', account: { phone: null, active: false }, guardians: [{ id: guardianId, relation: 'ibu', phone: null }] });

    const set = bodyOf<StudentContacts>(await put(wali, bayu(), { studentPhone, guardians: [{ guardianId, phone: parentPhone }] }).expect(200));
    expect(set.account).toEqual({ phone: `${studentPhone.slice(0, 6)}****${studentPhone.slice(-4)}`, active: true });
    expect(set.guardians[0]?.phone).toBe(`${parentPhone.slice(0, 6)}****${parentPhone.slice(-4)}`);
    expect(JSON.stringify(set)).not.toContain(studentPhone);
    expect(bodyOf<StudentContacts>(await contacts(admin, bayu()).expect(200)).account.active).toBe(true);

    // The guardian number is stored encrypted (it now receives messages) and never in the audit log.
    const [g] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.guardians).where(eq(schema.guardians.id, guardianId)));
    expect(g?.phone?.reveal()).toBe(parentPhone);
    const logs = await getDb().db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'student.contacts_updated')));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(parentPhone.slice(-8));
    expect(JSON.stringify(logs)).not.toContain(studentPhone.slice(-8));

    // A number of another account is refused; a wrong guardian too.
    const citra = students['CITRA DEWI']?.id ?? '';
    expect(bodyOf<{ details: unknown }>(await put(wali, citra, { studentPhone }).expect(409)).details).toEqual({ reason: 'phone_taken' });
    await put(wali, citra, { guardians: [{ guardianId, phone: null }] }).expect(400);
  });

  it('gives the student their own history after an OTP login, and nothing else', async () => {
    const student = await otpLogin(studentPhone);
    const history = bodyOf<PortalAttendance>(await student.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(200));
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      name: 'BAYU SAPUTRA',
      className: '8A',
      today: { date: today, status: null },
      counts: { H: 2, S: 1, A: 1, I: 0, T: 0 },
    });
    expect(history.items[0]?.days.map((d) => d.status)).toEqual(['H', 'H', 'S', 'A']);
    await wali.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(403);

    // A new number moves the login; ending it suspends the membership.
    const newPhone = testPhone();
    phones.push(newPhone);
    await put(wali, bayu(), { studentPhone: newPhone }).expect(200);
    await (await otpLogin(newPhone)).get('/api/v1/portal/attendance').set('X-School-Id', school).expect(200);
    expect(bodyOf<StudentContacts>(await put(wali, bayu(), { studentPhone: null }).expect(200)).account.active).toBe(false);
    await student.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(403);
  });

  it('shows a parent account their children only', async () => {
    const parent = await t.parent(testPhone(), 'Ibu Bayu');
    await t.member(school, parent.id, 'orang_tua');
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.guardians).set({ userId: parent.id }).where(eq(schema.guardians.id, guardianId)));
    const agent = await otpLogin(parent.phoneNumber);
    const history = bodyOf<PortalAttendance>(await agent.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(200));
    expect(history.items.map((i) => i.name)).toEqual(['BAYU SAPUTRA']);
  });
});

describe('guardian portal access (ORT-02, needed by GRB-09 and KEG-02)', () => {
  const parentPhone = testPhone();
  phones.push(parentPhone);
  let citra: string;
  let eka: string;
  let citraGuardian: string;
  let ekaGuardian: string;
  const names = async (agent: Agent) => bodyOf<PortalAttendance>(await agent.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(200)).items.map((i) => i.name);

  beforeAll(async () => {
    citra = students['CITRA DEWI']?.id ?? '';
    await withTenant({ schoolId: school, userId: null }, async (tx) => {
      const [enr] = await tx.select().from(schema.enrollments).where(eq(schema.enrollments.studentId, citra));
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name: 'EKA DEWI' }).returning();
      eka = s?.id ?? '';
      await tx.insert(schema.enrollments).values({ schoolId: school, studentId: eka, classId: enr?.classId ?? '', academicYearId: enr?.academicYearId ?? '', startsOn: '2026-07-13' });
      // Dapodik keeps one guardian row per student, so siblings' mother appears twice.
      const [g1, g2] = await tx.insert(schema.guardians).values([{ schoolId: school, name: 'Ibu Dewi' }, { schoolId: school, name: 'Ibu Dewi' }]).returning();
      citraGuardian = g1?.id ?? '';
      ekaGuardian = g2?.id ?? '';
      await tx.insert(schema.studentGuardians).values([
        { schoolId: school, studentId: citra, guardianId: citraGuardian, relation: 'ibu', isPrimary: true },
        { schoolId: school, studentId: eka, guardianId: ekaGuardian, relation: 'ibu', isPrimary: true },
      ]);
    });
  });

  it('opens and closes the parent login, one account for siblings', async () => {
    await put(wali, citra, { guardians: [{ guardianId: citraGuardian, portal: true }] }).expect(400);

    const on = bodyOf<StudentContacts>(await put(wali, citra, { guardians: [{ guardianId: citraGuardian, phone: parentPhone, portal: true }] }).expect(200));
    expect(on.guardians[0]).toMatchObject({ id: citraGuardian, portal: true });
    const parent = await otpLogin(parentPhone);
    expect(await names(parent)).toEqual(['CITRA DEWI']);

    // The sibling's guardian row with the same number reuses the same login.
    await put(admin, eka, { guardians: [{ guardianId: ekaGuardian, phone: parentPhone, portal: true }] }).expect(200);
    expect((await names(parent)).sort()).toEqual(['CITRA DEWI', 'EKA DEWI']);

    // Closing one keeps the other; closing both ends the membership. The number stays for messages.
    const off = bodyOf<StudentContacts>(await put(wali, citra, { guardians: [{ guardianId: citraGuardian, portal: false }] }).expect(200));
    expect(off.guardians[0]).toMatchObject({ portal: false, phone: `${parentPhone.slice(0, 6)}****${parentPhone.slice(-4)}` });
    expect(await names(parent)).toEqual(['EKA DEWI']);
    await put(admin, eka, { guardians: [{ guardianId: ekaGuardian, phone: null }] }).expect(200);
    await parent.get('/api/v1/portal/attendance').set('X-School-Id', school).expect(403);

    const logs = await getDb().db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.entityId, citra))).orderBy(schema.auditLogs.createdAt);
    expect(logs.map((l) => (l.after as { guardianPortal?: unknown }).guardianPortal).filter(Boolean)).toEqual([
      [{ guardianId: citraGuardian, portal: 'on' }],
      [{ guardianId: citraGuardian, portal: 'off' }],
    ]);
  });

  it("refuses a student's own login as a parent account", async () => {
    const studentPhone = testPhone();
    phones.push(studentPhone);
    await put(wali, eka, { studentPhone }).expect(200);
    const res = await put(wali, citra, { guardians: [{ guardianId: citraGuardian, phone: studentPhone, portal: true }] }).expect(409);
    expect(bodyOf<{ details: unknown }>(res).details).toEqual({ reason: 'phone_student' });
  });
});
