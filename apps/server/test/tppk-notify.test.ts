import { schema } from '@absah/db';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyConsumers } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type Consumer, type EventType } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, testPhone } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

// 10.00 WIB today: outside the quiet hours, so messages are released at once.
const clock = new Date(`${schoolDate('Asia/Jakarta')}T03:00:00Z`);
let school: string;
let consumers: Map<string, Consumer>;
const people: Record<string, { id: string; email: string; phone: string | null }> = {};

const envelope = <T extends EventType>(type: T, payload: object) => ({ id: uuidv7(), schoolId: school, type, payload, traceId: null, occurredAt: new Date().toISOString() });
const run = (name: string, data: unknown) => {
  const consumer = consumers.get(name);
  if (!consumer) throw new Error(`no consumer ${name}`);
  return runConsumer(consumer, data);
};
const sent = () =>
  withTenant({ schoolId: school, userId: null }, async (tx) =>
    (
      await tx
        .select({ templateCode: schema.notifications.templateCode, to: schema.notifications.toPhone, params: schema.notifications.params })
        .from(schema.notifications)
        .orderBy(asc(schema.notifications.createdAt))
    ).map((r) => ({ templateCode: r.templateCode, to: r.to.reveal(), params: JSON.parse(r.params.reveal()) as Record<string, string> })),
  );

beforeAll(async () => {
  school = await t.school('smp', 'SMP Pesan TPPK');
  for (const [label, role, withPhone] of [
    ['ketua', 'guru', true],
    ['anggota', 'wali_kelas', false],
    ['baru', 'guru', true],
    ['kepsek', 'kepsek', true],
    ['admin', 'admin', false],
  ] as const) {
    const u = await t.staff(`Bu ${label}`);
    const phone = withPhone ? testPhone() : null;
    if (phone) await getDb().db.update(schema.user).set({ phoneNumber: phone }).where(eq(schema.user.id, u.id));
    people[label] = { ...u, phone };
    await t.member(school, u.id, role);
  }
  await getDb()
    .db.insert(schema.tppkMembers)
    .values(['ketua', 'anggota'].map((l) => ({ schoolId: school, userId: people[l]?.id ?? '' })));
  consumers = new Map(notifyConsumers({ sender: new FakeMessageSender(), appUrl: 'https://absah.test', now: () => clock }).map((c) => [c.name, c]));
});

describe('TPPK notifications (KSW-06)', () => {
  it('tells only the TPPK members with a WhatsApp number, never the kepsek, and nothing of the report', async () => {
    const event = envelope('tppk.report_received', { reportId: uuidv7() });
    expect(await run('notify_tppk_report_received', event)).toBe('handled');
    expect(await run('notify_tppk_report_received', event)).toBe('duplicate');
    expect(await sent()).toEqual([{ templateCode: 'tppk_report_received', to: people.ketua?.phone, params: { school: 'SMP Pesan TPPK', link: 'https://absah.test/tppk' } }]);
  });

  it('sends nothing when no member can be reached', async () => {
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.notifications));
    await getDb().db.delete(schema.tppkMembers).where(eq(schema.tppkMembers.userId, people.ketua?.id ?? ''));
    await run('notify_tppk_report_received', envelope('tppk.report_received', { reportId: uuidv7() }));
    expect(await sent()).toEqual([]);
    await getDb().db.insert(schema.tppkMembers).values({ schoolId: school, userId: people.ketua?.id ?? '' });
  });

  it('tells the current team who was added and who was removed', async () => {
    await getDb().db.insert(schema.tppkMembers).values({ schoolId: school, userId: people.baru?.id ?? '' });
    await run('notify_tppk_team_changed', envelope('tppk.members_changed', { added: [people.baru?.id], removed: [people.kepsek?.id] }));
    const rows = (await sent()).filter((r) => r.templateCode === 'tppk_team_changed');
    expect(rows.map((r) => r.to).sort()).toEqual([people.ketua?.phone, people.baru?.phone].sort());
    expect(rows[0]?.params).toEqual({ school: 'SMP Pesan TPPK', added: 'Bu baru', removed: 'Bu kepsek', link: 'https://absah.test/tppk' });
  });

  it('shows the admin which members cannot be reached yet', async () => {
    const admin = t.agent();
    await signIn(admin, people.admin?.email ?? '').expect(200);
    await enableTotp(admin);
    const res = await admin.get('/api/v1/tppk/members').set('X-School-Id', school).expect(200);
    const items = (res.body as { items: { name: string; canBeNotified: boolean }[] }).items;
    expect(Object.fromEntries(items.map((m) => [m.name, m.canBeNotified]))).toEqual({ 'Bu ketua': true, 'Bu anggota': false, 'Bu baru': true });
  });
});
