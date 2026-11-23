import { createHmac } from 'node:crypto';
import { schema, sensitive } from '@absah/db';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processStatusWebhooks } from '../src/modules/notify';
import { withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const SECRET = 'wa-test-secret';
let school: string;
let admin: Agent;
let guru: Agent;
let enrollment: string;

const statusBody = (statuses: { id: string; status: string; timestamp?: number; errors?: { code: number }[] }[]) =>
  JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { statuses } }] }] });
const post = (body: string, secret = SECRET) =>
  request(t.app)
    .post('/api/v1/webhooks/whatsapp')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`)
    .send(body);

/** Sent notifications with provider ids, as notify_send leaves them. */
async function sentMessages(count: number) {
  const ids = Array.from({ length: count }, () => `wamid.${uuidv7()}`);
  await withTenant({ schoolId: school, userId: null }, (tx) =>
    tx.insert(schema.notifications).values(
      ids.map((providerMessageId, i) => ({
        schoolId: school,
        dedupKey: providerMessageId,
        enrollmentId: enrollment,
        templateCode: 'absent_marked',
        toPhone: sensitive(`+628120000000${i}`),
        params: sensitive('{}'),
        status: 'sent' as const,
        providerMessageId,
        sentAt: new Date(),
        releasedAt: new Date(),
        attempts: 1,
      })),
    ),
  );
  return ids;
}
const rowsOf = (ids: string[]) =>
  withTenant({ schoolId: school, userId: null }, (tx) =>
    tx
      .select({ id: schema.notifications.providerMessageId, status: schema.notifications.status, deliveredAt: schema.notifications.deliveredAt, readAt: schema.notifications.readAt, lastError: schema.notifications.lastError })
      .from(schema.notifications)
      .where(inArray(schema.notifications.providerMessageId, ids)),
  );
const shuffle = <T>(items: T[]) => items.map((v) => ({ v, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.v);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Webhook');
  const a = await t.staff('Admin Notif');
  const g = await t.staff('Guru Notif');
  await t.member(school, a.id, 'admin');
  await t.member(school, g.id, 'guru');
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8A', grade: 8 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'BAYU SAPUTRA' }).returning();
    const [e] = await tx
      .insert(schema.enrollments)
      .values({ schoolId: school, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })
      .returning();
    enrollment = e?.id ?? '';
  });
});

describe('WhatsApp status webhooks (NTF)', () => {
  it('answers the registration check and refuses unsigned or wrongly signed posts', async () => {
    const ok = await request(t.app).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wa-test-verify', 'hub.challenge': '12345' }).expect(200);
    expect(ok.text).toBe('12345');
    await request(t.app).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'salah', 'hub.challenge': '1' }).expect(401);
    const body = statusBody([{ id: 'wamid.x', status: 'read' }]);
    await post(body, 'other-secret').expect(401);
    await request(t.app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').send(body).expect(401);
  });

  it('ends at the right status whatever order the updates arrive in', async () => {
    const messages = await sentMessages(6);
    const at = Math.floor(Date.now() / 1000);
    const updates = messages.flatMap((id) => (['sent', 'delivered', 'read'] as const).map((status, i) => ({ id, status, timestamp: at + i })));
    // One webhook per update, shuffled, some delivered twice by the provider.
    const shuffled = shuffle(updates);
    for (const u of [...shuffled, ...shuffled.slice(0, 5)]) await post(statusBody([u])).expect(200);
    // Applied in two rounds, the second with whatever came in between.
    await processStatusWebhooks();
    await processStatusWebhooks();

    const rows = await rowsOf(messages);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.status === 'read' && r.deliveredAt && r.readAt)).toBe(true);
  });

  it('keeps delivered over a late failure, records a real failure, and waits for unknown ids', async () => {
    const [delivered, failing] = await sentMessages(2);
    const unknown = `wamid.${uuidv7()}`;
    await post(statusBody([{ id: failing ?? '', status: 'failed', errors: [{ code: 131026 }] }, { id: delivered ?? '', status: 'failed', errors: [{ code: 131000 }] }])).expect(200);
    await post(statusBody([{ id: delivered ?? '', status: 'delivered' }, { id: unknown, status: 'delivered' }])).expect(200);
    const first = await processStatusWebhooks();
    expect(first.waiting).toBeGreaterThanOrEqual(1); // inbox_webhooks is shared by the whole test database
    expect(Object.fromEntries((await rowsOf([delivered ?? '', failing ?? ''])).map((r) => [r.id, [r.status, r.lastError]]))).toEqual({
      [delivered ?? '']: ['delivered', null],
      [failing ?? '']: ['failed', 'wa_131026'],
    });
    // A status for a message never stored is dropped after a day.
    expect((await processStatusWebhooks(new Date(Date.now() + 25 * 60 * 60_000))).waiting).toBe(0);
    expect((await processStatusWebhooks()).waiting).toBe(0);
  });
});

describe('GET /notifications/overview', () => {
  it('shows admins today’s counts and masked failures; others are refused', async () => {
    await guru.get('/api/v1/notifications/overview').set('X-School-Id', school).expect(403);
    const body = (await admin.get('/api/v1/notifications/overview').set('X-School-Id', school).expect(200)).body as {
      counts: Record<string, number>;
      failed: { recipient: string; studentName: string; lastError: string }[];
    };
    expect(body.counts).toMatchObject({ read: 6, delivered: 1, failed: 1, queued: 0 });
    expect(body.failed).toEqual([expect.objectContaining({ recipient: '+62812****0001', studentName: 'Bayu', lastError: 'wa_131026' })]);
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.status, 'failed')));
    expect(row).toBeDefined();
  });
});
