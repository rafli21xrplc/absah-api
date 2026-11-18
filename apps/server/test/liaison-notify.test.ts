import { schema, sensitive } from '@absah/db';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyConsumers } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
const at = (hhmm: string) => new Date(`${today}T${hhmm}:00+07:00`);
let clock = at('10:00');
let school: string;
let ani: string;
let notify: Consumer;
const a: Record<string, Agent> = {};
const phones: Record<string, string> = {};
const key = () => `liaison-wa-${uuidv7()}`;
const post = (agent: Agent, path: string, body: object) => agent.post(`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);

/** Posts through the API and runs the notify consumer on the resulting event. */
async function write(who: string, body: string) {
  const res = await post(a[who] as Agent, `/liaison/students/${ani}/messages`, { body }).expect(200);
  const messages = (res.body as { messages: { id: string }[] }).messages;
  const messageId = messages[messages.length - 1]?.id ?? '';
  return runConsumer(notify, { id: uuidv7(), schoolId: school, type: 'liaison.message_posted', payload: { messageId }, traceId: null, occurredAt: new Date().toISOString() });
}

const sent = () =>
  withTenant({ schoolId: school, userId: null }, async (tx) =>
    (
      await tx
        .select({ templateCode: schema.notifications.templateCode, to: schema.notifications.toPhone, params: schema.notifications.params, scheduledFor: schema.notifications.scheduledFor })
        .from(schema.notifications)
        .orderBy(asc(schema.notifications.createdAt))
    ).map((r) => ({ to: r.to.reveal(), params: JSON.parse(r.params.reveal()) as Record<string, string>, scheduledFor: r.scheduledFor.toISOString(), templateCode: r.templateCode })),
  );

beforeAll(async () => {
  school = await t.school('smp', 'SMP Kabar Rumah');
  const ids: Record<string, string> = {};
  for (const [label, role] of [
    ['admin', 'admin'],
    ['wali', 'guru'],
    ['mapel', 'guru'],
    ['ortu', 'orang_tua'],
  ] as const) {
    const u = await t.staff(`Bu ${label}`);
    ids[label] = u.id;
    phones[label] = testPhone();
    await getDb().db.update(schema.user).set({ phoneNumber: phones[label] }).where(eq(schema.user.id, u.id));
    await t.member(school, u.id, role);
    a[label] = t.agent();
    await signIn(a[label], u.email).expect(200);
  }
  await enableTotp(a.admin as Agent);
  phones.nenek = testPhone();

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8C', grade: 8, homeroomTeacherId: ids.wali }).returning();
    const [st] = await tx.insert(schema.students).values({ schoolId: school, name: 'ANI LESTARI' }).returning();
    ani = st?.id ?? '';
    await tx.insert(schema.enrollments).values({ schoolId: school, studentId: ani, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' });
    const [subject] = await tx.insert(schema.subjects).values({ schoolId: school, name: 'IPS' }).returning();
    await tx.insert(schema.scheduleSlots).values({ schoolId: school, academicYearId: year?.id ?? '', ownerType: 'class', ownerId: cls?.id ?? '', day: 2, period: 1, subjectId: subject?.id ?? '', teacherId: ids.mapel });
    const guardians = await tx
      .insert(schema.guardians)
      .values([
        { schoolId: school, name: 'Bu ortu', userId: ids.ortu, phone: sensitive(phones.ortu ?? '') },
        { schoolId: school, name: 'Nenek', phone: sensitive(phones.nenek ?? '') }, // no account: cannot read the thread
      ])
      .returning();
    await tx.insert(schema.studentGuardians).values(guardians.map((g, i) => ({ schoolId: school, studentId: ani, guardianId: g.id, relation: i === 0 ? ('ibu' as const) : ('wali' as const), isPrimary: i === 0 })));
  });
  notify = notifyConsumers({ sender: new FakeMessageSender(), appUrl: 'https://absah.test', now: () => clock }).find((c) => c.name === 'notify_liaison_message') as Consumer;
});

describe('buku penghubung notifications (ORT-07)', () => {
  it('sends a parent’s message to the wali kelas only, without the text, once per hour', async () => {
    expect(await write('ortu', 'Ani sakit perut, mohon izin pulang cepat.')).toBe('handled');
    clock = at('10:20');
    await write('ortu', 'Terima kasih.');
    const rows = await sent();
    expect(rows).toEqual([
      {
        templateCode: 'liaison_message',
        to: phones.wali,
        params: { school: 'SMP Kabar Rumah', first_name: 'Ani', sender: 'orang tua', url: `https://absah.test/penghubung/${ani}` },
        scheduledFor: at('10:00').toISOString(),
      },
    ]);
  });

  it('holds a teacher’s evening reply to the parents with an account until 06.00', async () => {
    clock = at('19:30');
    await write('mapel', 'Baik Bu, semoga lekas sembuh.');
    const rows = (await sent()).slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ to: phones.ortu, params: { sender: 'guru', url: `https://absah.test/portal/penghubung/${ani}` } });
    const next = new Date(at('06:00').getTime() + 86_400_000).toISOString();
    expect(rows[0]?.scheduledFor).toBe(next);
  });

  it('uses the service hours the admin sets', async () => {
    await a.wali?.put('/api/v1/liaison/settings').set('X-School-Id', school).set('Idempotency-Key', key()).send({ startsAt: '07:00', endsAt: '15:00' }).expect(403);
    await a.admin?.put('/api/v1/liaison/settings').set('X-School-Id', school).set('Idempotency-Key', key()).send({ startsAt: '15:00', endsAt: '07:00' }).expect(400);
    const res = await a.admin?.put('/api/v1/liaison/settings').set('X-School-Id', school).set('Idempotency-Key', key()).send({ startsAt: '07:00', endsAt: '15:00' }).expect(200);
    expect(res?.body).toEqual({ startsAt: '07:00', endsAt: '15:00' });
    clock = at('16:00');
    await write('wali', 'Besok ada ulangan IPS.');
    const last = (await sent()).at(-1);
    expect(last?.scheduledFor).toBe(new Date(at('07:00').getTime() + 86_400_000).toISOString());
  });
});
