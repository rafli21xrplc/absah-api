import type { NotificationPreferences, TemplateCode } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queueMessages } from '../src/modules/notify/application/queue';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
/** 10.00 and 19.30 WIB today; 06.00 WIB the next morning. */
const daytime = new Date(`${today}T03:00:00Z`);
const evening = new Date(`${today}T12:30:00Z`);
const nextMorning = new Date(`${today}T23:00:00Z`);

let school: string;
let studentId: string;
let ibu: { guardianId: string; agent: Agent };
let ayah: { guardianId: string; agent: Agent };
let guru: Agent;

const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const prefs = (agent: Agent) => agent.get('/api/v1/portal/notification-preferences').set('X-School-Id', school);
const put = (agent: Agent, body: object, key = uuidv7()) =>
  agent.put('/api/v1/portal/notification-preferences').set('X-School-Id', school).set('Idempotency-Key', key).send(body);

async function otpLogin(phoneNumber: string) {
  const agent = t.agent();
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
  await agent.post('/api/auth/phone-number/verify').send({ phoneNumber, code: t.messageSender.lastCodeFor(phoneNumber) }).expect(200);
  return agent;
}

/** A parent with a login, linked to a guardian row of the student. */
async function parentOf(name: string, number: string, relation: 'ibu' | 'ayah') {
  const phone = testPhone();
  const account = await t.parent(phone, name);
  await t.member(school, account.id, 'orang_tua');
  const guardianId = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name, phone: sensitive(number), userId: account.id }).returning({ id: schema.guardians.id });
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId, guardianId: g?.id ?? '', relation, isPrimary: relation === 'ibu' });
    return g?.id ?? '';
  });
  return { guardianId, agent: await otpLogin(phone) };
}

/** One message per guardian through the real queue; returns what was created for each, in guardian order. */
async function send(code: TemplateCode, now: Date) {
  await withTenant({ schoolId: school, userId: null }, (tx) =>
    queueMessages(tx, {
      schoolId: school,
      timezone: 'Asia/Jakarta',
      eventId: uuidv7(),
      templateCode: code,
      enrollmentId: null,
      recipients: [
        { guardianId: ibu.guardianId, studentId, phone: '+6281200000011' },
        { guardianId: ayah.guardianId, studentId, phone: '+6281200000012' },
      ],
      dedupKey: (r) => `${code}:${uuidv7()}:${r.guardianId}`,
      params: { school: 'SD Preferensi' },
      appUrl: 'https://absah.test',
      now,
    }),
  );
  const rows = await withTenant({ schoolId: school, userId: null }, (tx) =>
    tx
      .select({ guardianId: schema.notifications.guardianId, scheduledFor: schema.notifications.scheduledFor, releasedAt: schema.notifications.releasedAt })
      .from(schema.notifications)
      .where(eq(schema.notifications.templateCode, code))
      .orderBy(asc(schema.notifications.createdAt)),
  );
  return { rows, of: (guardianId: string) => rows.filter((r) => r.guardianId === guardianId) };
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Preferensi');
  const staff = await t.staff('Bu Guru Preferensi');
  await t.member(school, staff.id, 'guru');
  guru = t.agent();
  await signIn(guru, staff.email).expect(200);
  studentId = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [s] = await tx.insert(schema.students).values({ schoolId: school, name: 'DEWI ANGGRAINI' }).returning({ id: schema.students.id });
    return s?.id ?? '';
  });
  ibu = await parentOf('Ibu Dewi', '+6281200000011', 'ibu');
  ayah = await parentOf('Ayah Dewi', '+6281200000012', 'ayah');
});

describe('notification preferences (ORT-06)', () => {
  it('starts at the defaults and shows only a masked number', async () => {
    const res = bodyOf<NotificationPreferences>(await prefs(ibu.agent).expect(200));
    expect(res).toEqual({ phone: '+62812****0011', mutedTypes: [], noLateMessages: false });
  });

  it('is for parents only, and for a member of that school', async () => {
    await prefs(guru).expect(403);
    await put(guru, { mutedTypes: [], noLateMessages: false }).expect(403);
    await prefs(ibu.agent).set('X-School-Id', uuidv7()).expect(403);
  });

  it('refuses types that cannot be switched off, and bad bodies', async () => {
    for (const mutedTypes of [['unlisted_pickup'], ['login_otp'], ['tppk_report_received'], ['bogus']]) {
      await put(ibu.agent, { mutedTypes, noLateMessages: false }).expect(400);
    }
    await put(ibu.agent, { mutedTypes: [] }).expect(400);
    expect(bodyOf<NotificationPreferences>(await prefs(ibu.agent).expect(200)).mutedTypes).toEqual([]);
  });

  it('saves, de-duplicates and replays idempotently', async () => {
    const key = uuidv7();
    const first = await put(ibu.agent, { mutedTypes: ['leave_approved', 'leave_approved', 'liaison_message'], noLateMessages: true }, key).expect(200);
    expect(bodyOf<NotificationPreferences>(first)).toMatchObject({ mutedTypes: ['leave_approved', 'liaison_message'], noLateMessages: true });
    const replay = await put(ibu.agent, { mutedTypes: ['leave_approved', 'leave_approved', 'liaison_message'], noLateMessages: true }, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(bodyOf<NotificationPreferences>(await prefs(ibu.agent).expect(200))).toMatchObject({ mutedTypes: ['leave_approved', 'liaison_message'], noLateMessages: true });
    // The other parent's choices are their own.
    expect(bodyOf<NotificationPreferences>(await prefs(ayah.agent).expect(200))).toMatchObject({ mutedTypes: [], noLateMessages: false });
    // Audited once (the replay wrote nothing), with the choices but never the number.
    const audits = await getDb().db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'notification.preferences_updated')));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain('6281200000011');
  });

  it('does not create a message of a switched-off type, but sends it to the other parent', async () => {
    const { of, rows } = await send('leave_approved', daytime);
    expect(of(ibu.guardianId)).toHaveLength(0);
    expect(of(ayah.guardianId)).toHaveLength(1);
    expect(rows).toHaveLength(1);
    // A type the parent did not switch off still arrives.
    const absent = await send('absent_marked', daytime);
    expect(absent.of(ibu.guardianId)).toHaveLength(1);
  });

  it('holds a late message for the parent who asked, and only for them', async () => {
    const { of } = await send('student_picked_up', evening);
    const [mine] = of(ibu.guardianId);
    const [theirs] = of(ayah.guardianId);
    expect(mine?.scheduledFor).toEqual(nextMorning);
    expect(mine?.releasedAt).toBeNull();
    // 19.30 is before the quiet hours, so the other parent gets it at once.
    expect(theirs?.scheduledFor).toEqual(evening);
    expect(theirs?.releasedAt).not.toBeNull();
  });

  it('sends a late message at once after the parent turns the preference off', async () => {
    await put(ibu.agent, { mutedTypes: [], noLateMessages: false }).expect(200);
    const { of } = await send('student_sent_home', evening);
    expect(of(ibu.guardianId)[0]?.releasedAt).not.toBeNull();
  });

  it('never drops a safety message, even with a stale row that names it', async () => {
    await withTenant({ schoolId: school, userId: null }, (tx) =>
      tx.update(schema.notificationPreferences).set({ mutedTypes: ['unlisted_pickup'] }).where(eq(schema.notificationPreferences.guardianId, ibu.guardianId)),
    );
    const { of } = await send('unlisted_pickup', daytime);
    expect(of(ibu.guardianId)).toHaveLength(1);
  });
});
