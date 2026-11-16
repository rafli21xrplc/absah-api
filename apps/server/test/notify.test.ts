import { schema, sensitive } from '@absah/db';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool, generateForSchool } from '../src/modules/attendance';
import { notifyConsumers, releaseDueNotifications } from '../src/modules/notify';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { FakeMessageSender, SendError } from '../src/shared/messaging';
import { runConsumer, type Consumer, type EventType } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
// 10.00 WIB today (outside the quiet hours) and 22.30 WIB today (inside).
const daytime = new Date(`${today}T03:00:00Z`);
const night = new Date(`${today}T15:30:00Z`);
let clock = daytime;

let school: string;
let enrollment: string;
let sessionId: string;
let leaveId: string;
let sender: FakeMessageSender;
let consumers: Map<string, Consumer>;

const envelope = <T extends EventType>(type: T, payload: object) => ({ id: uuidv7(), schoolId: school, type, payload, traceId: null, occurredAt: new Date().toISOString() });
const run = (name: string, data: unknown, delivery?: { attempt: number; lastAttempt: boolean }) => {
  const consumer = consumers.get(name);
  if (!consumer) throw new Error(`no consumer ${name}`);
  return runConsumer(consumer, data, delivery);
};
const notificationRows = () =>
  withTenant({ schoolId: school, userId: null }, (tx) =>
    tx
      .select({ id: schema.notifications.id, status: schema.notifications.status, templateCode: schema.notifications.templateCode, lastError: schema.notifications.lastError, attempts: schema.notifications.attempts, providerMessageId: schema.notifications.providerMessageId, releasedAt: schema.notifications.releasedAt })
      .from(schema.notifications)
      .orderBy(asc(schema.notifications.createdAt)),
  );
/** notification.queued events the outbox holds for these notifications (read as owner). */
async function queuedEvents(ids: string[]) {
  const rows = await getDb()
    .db.select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'notification.queued')));
  return rows.filter((r) => ids.includes((r.payload as { notificationId: string }).notificationId)).map((r) => ({ ...envelope('notification.queued', r.payload as object), id: r.id }));
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Notifikasi');
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '3A', grade: 3 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'ANI LESTARI' }).returning();
    const [enrolled] = await tx
      .insert(schema.enrollments)
      .values({ schoolId: school, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })
      .returning();
    enrollment = enrolled?.id ?? '';
    const guardians = await tx
      .insert(schema.guardians)
      .values([
        { schoolId: school, name: 'Ibu Ani', phone: sensitive('+6281200000001') },
        { schoolId: school, name: 'Ayah Ani', phone: sensitive('+6281200000002') },
        { schoolId: school, name: 'Nenek Ani' }, // no number: no message
      ])
      .returning();
    await tx
      .insert(schema.studentGuardians)
      .values(guardians.map((g, i) => ({ schoolId: school, studentId: student?.id ?? '', guardianId: g.id, relation: (['ibu', 'ayah', 'wali'] as const)[i] ?? 'wali', isPrimary: i === 0 })));
    const [leave] = await tx
      .insert(schema.leaveRequests)
      .values({ schoolId: school, enrollmentId: enrollment, kind: 'sakit', startsOn: today, endsOn: today, reason: sensitive('Demam'), status: 'approved' })
      .returning();
    leaveId = leave?.id ?? '';
  });
  const row = await withPlatform((tx) => findSchool(tx, school));
  if (!row) throw new Error('no school');
  await generateForSchool(row, today, new Date(), { force: true });
  const [session] = await getDb().db.select({ id: schema.attendanceSessions.id }).from(schema.attendanceSessions).where(eq(schema.attendanceSessions.schoolId, school));
  sessionId = session?.id ?? '';
  sender = new FakeMessageSender();
  consumers = new Map(notifyConsumers({ sender, appUrl: 'https://absah.test', now: () => clock }).map((c) => [c.name, c]));
});

describe('notify (NTF)', () => {
  it('sends one alpa message per guardian per day, whatever is redelivered', async () => {
    const event = envelope('attendance.absent_marked', { sessionId, enrollmentId: enrollment });
    expect(await run('notify_absent_marked', event)).toBe('handled');
    expect(await run('notify_absent_marked', event)).toBe('duplicate');
    // Another alpa the same day (another session, or marked again): no new message.
    await run('notify_absent_marked', envelope('attendance.absent_marked', { sessionId, enrollmentId: enrollment }));

    const rows = await notificationRows();
    expect(rows.map((r) => [r.templateCode, r.status])).toEqual([
      ['absent_marked', 'queued'],
      ['absent_marked', 'queued'],
    ]);
    const events = await queuedEvents(rows.map((r) => r.id));
    expect(events).toHaveLength(2);
    for (const e of events) {
      await run('notify_send', e);
      expect(await run('notify_send', e)).toBe('duplicate');
      await run('notify_send', { ...e, id: uuidv7() }); // a second event for a sent message sends nothing
    }

    expect(sender.messages.map((m) => m.to).sort()).toEqual(['+6281200000001', '+6281200000002']);
    const text = sender.messages[0]?.text ?? '';
    expect(text).toContain('SD Notifikasi: Ani tercatat tidak hadir tanpa keterangan (alpa)');
    expect(text).not.toContain('LESTARI');
    expect(sender.messages[0]?.params).toEqual(['SD Notifikasi', 'Ani', expect.stringContaining('2026'), 'https://absah.test/portal']);
    expect((await notificationRows()).every((r) => r.status === 'sent' && r.attempts === 1 && r.providerMessageId)).toBe(true);
  });

  it('holds messages in the quiet hours until 06.00', async () => {
    clock = night;
    await run('notify_leave_approved', envelope('leave.approved', { leaveRequestId: leaveId }));
    clock = daytime;
    const held = (await notificationRows()).filter((r) => r.templateCode === 'leave_approved');
    expect(held).toHaveLength(2);
    expect(held.every((r) => r.releasedAt === null)).toBe(true);
    expect(await queuedEvents(held.map((r) => r.id))).toHaveLength(0);

    expect(await releaseDueNotifications(new Date(night.getTime() + 60 * 60_000))).toBe(0);
    expect(await releaseDueNotifications(new Date(night.getTime() + 8 * 60 * 60_000))).toBe(2); // 06.30 WIB
    const events = await queuedEvents(held.map((r) => r.id));
    expect(events).toHaveLength(2);
    for (const e of events) await run('notify_send', e);
    expect(sender.messages.at(-1)?.text).toMatch(/izin sakit untuk Ani \(\d+ \w+ 2026\) disetujui/);
  });

  it('retries a failing send three times in all, then marks it failed', async () => {
    const event = envelope('leave.rejected', { leaveRequestId: leaveId });
    await run('notify_leave_rejected', event);
    const [first, second] = (await notificationRows()).filter((r) => r.templateCode === 'leave_rejected');
    const [retried, final] = await queuedEvents([first?.id ?? '', second?.id ?? '']);

    sender.failures.push(new SendError('network', true), new SendError('http_503', true), new SendError('http_429:130429', true));
    await expect(run('notify_send', retried, { attempt: 0, lastAttempt: false })).rejects.toThrow('will retry');
    await expect(run('notify_send', retried, { attempt: 1, lastAttempt: false })).rejects.toThrow('will retry');
    expect(await run('notify_send', retried, { attempt: 2, lastAttempt: true })).toBe('handled');

    sender.failures.push(new SendError('http_400:131026', false));
    expect(await run('notify_send', final, { attempt: 0, lastAttempt: false })).toBe('handled');

    const rows = (await notificationRows()).filter((r) => r.templateCode === 'leave_rejected');
    expect(rows.map((r) => [r.status, r.attempts, r.lastError])).toEqual([
      ['failed', 3, 'http_429:130429'],
      ['failed', 1, 'http_400:131026'],
    ]);
  });

  it('never sends a template the provider has not approved', async () => {
    const strict = new (class extends FakeMessageSender {
      override readonly requiresApprovedTemplates = true;
    })();
    const strictConsumers = new Map(notifyConsumers({ sender: strict, appUrl: 'https://absah.test', now: () => clock }).map((c) => [c.name, c]));
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.notifications));
    await runConsumer(strictConsumers.get('notify_absent_marked') as Consumer, envelope('attendance.absent_marked', { sessionId, enrollmentId: enrollment }));
    const rows = await notificationRows();
    for (const e of await queuedEvents(rows.map((r) => r.id))) await runConsumer(strictConsumers.get('notify_send') as Consumer, e);
    expect(strict.messages).toHaveLength(0);
    expect((await notificationRows()).map((r) => [r.status, r.lastError])).toEqual([
      ['failed', 'template_not_approved'],
      ['failed', 'template_not_approved'],
    ]);
  });
});
