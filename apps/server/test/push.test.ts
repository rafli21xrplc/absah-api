import type { PushConfig, PushStatus } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushToUser } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { FakePushSender, PushError } from '../src/shared/push';
import { buildTestApp, signIn, testPhone, TEST_VAPID_PUBLIC_KEY, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let guru: { id: string; agent: Agent };
let other: { id: string; agent: Agent };

const bodyOf = <T>(res: { body: unknown }) => res.body as T;
/** A subscription shaped like the browser's: 65-byte p256dh and 16-byte auth in base64url. */
const sub = (n: number) => ({
  endpoint: `https://push.example.test/send/${n}-${uuidv7()}`,
  keys: { p256dh: Buffer.alloc(65, n).toString('base64url'), auth: Buffer.alloc(16, n).toString('base64url') },
});
const put = (agent: Agent, body: object, schoolId = school) => agent.put('/api/v1/push/subscriptions').set('X-School-Id', schoolId).set('Idempotency-Key', uuidv7()).send(body);
const remove = (agent: Agent, endpoint: string) => agent.post('/api/v1/push/subscriptions/remove').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ endpoint });
const rows = (userId: string) => withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId)));

async function member(name: string, role: 'guru' | 'pembimbing_industri') {
  const staff = await t.staff(name);
  await t.member(school, staff.id, role);
  const agent = t.agent();
  await signIn(agent, staff.email).expect(200);
  return { id: staff.id, agent };
}

beforeAll(async () => {
  school = await t.school('sma', 'SMA Push');
  guru = await member('Bu Guru Push', 'guru');
  other = await member('Pak Guru Lain', 'guru');
});

describe('Web Push subscriptions (NTF-06)', () => {
  it('hands the browser the public key and never the private one', async () => {
    const res = bodyOf<PushConfig>(await guru.agent.get('/api/v1/push/config').expect(200));
    expect(res.publicKey).toBe(TEST_VAPID_PUBLIC_KEY);
    await t.agent().get('/api/v1/push/config').expect(401);
  });

  it('stores a device encrypted, once per endpoint, and refreshes its keys', async () => {
    const a = sub(1);
    expect(bodyOf<PushStatus>(await put(guru.agent, a).expect(200))).toEqual({ devices: 1 });
    expect(bodyOf<PushStatus>(await put(guru.agent, { ...a, keys: sub(2).keys }).expect(200))).toEqual({ devices: 1 });
    const [row] = await rows(guru.id);
    expect(row?.endpoint.reveal()).toBe(a.endpoint);
    expect(row?.p256dh.reveal()).toBe(sub(2).keys.p256dh);
    // Encrypted at rest: the raw column holds no endpoint.
    const raw = await getDb().db.execute<{ endpoint: string }>(`select endpoint from push_subscriptions where user_id = '${guru.id}'` as never);
    expect(raw.rows).toHaveLength(1);
    expect(JSON.stringify(raw.rows)).not.toContain('push.example.test');
  });

  it('keeps each member to their own devices', async () => {
    await put(other.agent, sub(3)).expect(200);
    expect(await rows(guru.id)).toHaveLength(1);
    expect(await rows(other.id)).toHaveLength(1);
    // Inside a request a member cannot see another member's row, even in the same school.
    const seen = await withTenant({ schoolId: school, userId: other.id }, (tx) => tx.select({ userId: schema.pushSubscriptions.userId }).from(schema.pushSubscriptions));
    expect(seen.map((r) => r.userId)).toEqual([other.id]);
  });

  it('removes only the named device, and an unknown one is a no-op', async () => {
    const b = sub(4);
    const c = sub(5);
    await put(guru.agent, b).expect(200);
    await put(guru.agent, c).expect(200);
    expect(bodyOf<PushStatus>(await remove(guru.agent, b.endpoint).expect(200)).devices).toBe(2);
    expect(bodyOf<PushStatus>(await remove(guru.agent, b.endpoint).expect(200)).devices).toBe(2);
    expect((await rows(guru.id)).map((r) => r.endpoint.reveal())).not.toContain(b.endpoint);
  });

  it('keeps at most ten devices, dropping the oldest', async () => {
    const heavy = await member('Pak Banyak HP', 'guru');
    const endpoints: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const s = sub(10 + i);
      endpoints.push(s.endpoint);
      await put(heavy.agent, s).expect(200);
    }
    const kept = (await rows(heavy.id)).map((r) => r.endpoint.reveal());
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain(endpoints[0]);
    expect(kept).toContain(endpoints[11]);
  });

  it('refuses a bad body, other roles, and a school without membership', async () => {
    await put(guru.agent, { endpoint: 'http://insecure.example/x', keys: sub(1).keys }).expect(400);
    await put(guru.agent, { endpoint: sub(1).endpoint, keys: { p256dh: 'short', auth: 'short' } }).expect(400);
    await put(guru.agent, { ...sub(1), extra: true }).expect(400);
    const supervisor = await member('Pembimbing Industri', 'pembimbing_industri');
    await put(supervisor.agent, sub(1)).expect(403);
    const parent = await t.parent(testPhone(), 'Ibu Push');
    await t.member(school, parent.id, 'orang_tua');
    await put(guru.agent, sub(1), uuidv7()).expect(403);
  });

  it('replays a request with the same Idempotency-Key', async () => {
    const key = uuidv7();
    const body = sub(30);
    await guru.agent.put('/api/v1/push/subscriptions').set('X-School-Id', school).set('Idempotency-Key', key).send(body).expect(200);
    const replay = await guru.agent.put('/api/v1/push/subscriptions').set('X-School-Id', school).set('Idempotency-Key', key).send(body).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });
});

describe('pushToUser', () => {
  const message = { title: 'Absah', body: 'Ada tamu menunggu di gerbang', url: '/tamu', tag: 'visitor' };
  const send = (sender: FakePushSender, userId: string) => withTenant({ schoolId: school, userId: null }, (tx) => pushToUser(tx, sender, userId, message));

  it('sends to every device of the member and to nobody else', async () => {
    const sender = new FakePushSender();
    const user = await member('Bu Dua Perangkat', 'guru');
    await put(user.agent, sub(40)).expect(200);
    await put(user.agent, sub(41)).expect(200);
    expect(await send(sender, user.id)).toBe(2);
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent.every((s) => s.message === message)).toBe(true);
    expect(await send(sender, (await member('Tanpa Perangkat', 'guru')).id)).toBe(0);
    expect(sender.sent).toHaveLength(2);
  });

  it('drops a device the push service says is gone, and keeps the others', async () => {
    const sender = new FakePushSender();
    const user = await member('Bu Kedaluwarsa', 'guru');
    const dead = sub(50);
    await put(user.agent, dead).expect(200);
    await put(user.agent, sub(51)).expect(200);
    sender.failing.set(dead.endpoint, new PushError('gone', 'gone'));
    expect(await send(sender, user.id)).toBe(1);
    expect((await rows(user.id)).map((r) => r.endpoint.reveal())).not.toContain(dead.endpoint);
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('retries the event only when nothing got through and a failure can be retried', async () => {
    const sender = new FakePushSender();
    const user = await member('Bu Jaringan Putus', 'guru');
    const a = sub(60);
    const b = sub(61);
    await put(user.agent, a).expect(200);
    await put(user.agent, b).expect(200);
    sender.failing.set(a.endpoint, new PushError('down', 'retryable'));
    expect(await send(sender, user.id)).toBe(1); // b accepted: good enough
    sender.failing.set(b.endpoint, new PushError('down', 'retryable'));
    await expect(send(sender, user.id)).rejects.toMatchObject({ kind: 'retryable' });
    expect(await rows(user.id)).toHaveLength(2); // nothing dropped for a transient failure
    sender.failing.set(a.endpoint, new PushError('bad key', 'failed'));
    sender.failing.set(b.endpoint, new PushError('bad key', 'failed'));
    expect(await send(sender, user.id)).toBe(0); // a refusal is not retried, not dropped
  });
});
