import { schema } from '@absah/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { PgBoss, type JobInsert } from 'pg-boss';
import { pino } from 'pino';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, withPlatform, withTenant, withUser } from '../src/shared/db';
import {
  consumerQueue,
  defineConsumer,
  deleteOldOutboxRows,
  emit,
  markWebhookProcessed,
  recordWebhook,
  relayOutboxBatch,
  runConsumer,
  startOutbox,
  type JobSink,
  type OutboxEvent,
} from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn } from './harness';

const t = buildTestApp();
const boss = new PgBoss({
  connectionString: process.env.TEST_DATABASE_URL,
  schema: 'pgboss',
  supervise: false,
  schedule: false,
});

const handled: OutboxEvent<'membership.status_changed'>[] = [];
let failNext = false;
const recorder = defineConsumer({
  name: 'test_recorder',
  event: 'membership.status_changed',
  async handle(tx, event) {
    const { rows } = await tx.execute<{ school: string }>(sql`select current_setting('app.school_id') as school`);
    expect(rows[0]?.school).toBe(event.schoolId);
    if (failNext) {
      failNext = false;
      throw new Error('handler failed');
    }
    handled.push(event);
  },
});
const second = defineConsumer({ name: 'test_second', event: 'membership.status_changed', handle: async () => {} });
const consumers = [recorder, second];

let school: string;
let userId: string;

beforeAll(async () => {
  await boss.start();
  for (const c of consumers) await boss.createQueue(consumerQueue(c));
  school = await t.school('sma', 'SMA Outbox');
  userId = (await t.staff('Guru Outbox')).id;
});
afterAll(async () => {
  await boss.stop({ graceful: false });
  await t.cleanup();
});

const payload = () => ({ membershipId: uuidv7(), userId: uuidv7(), from: 'active' as const, to: 'suspended' as const });
const tenant = () => ({ schoolId: school, userId });
const eventRows = (ids: string[]) =>
  getDb().db.select().from(schema.outboxEvents).where(inArray(schema.outboxEvents.id, ids)); // owner read, test only

async function jobsFor(queue: string, eventIds: string[]) {
  const jobs = await boss.fetch<OutboxEvent>(queue, { batchSize: 1000 });
  return jobs.filter((j) => eventIds.includes(j.data.id));
}

describe('emit()', () => {
  it('writes the event in the caller transaction, scoped to its school', async () => {
    const id = await withTenant(tenant(), (tx) => emit(tx, 'membership.status_changed', payload()));
    const [row] = await eventRows([id]);
    expect(row).toMatchObject({ schoolId: school, type: 'membership.status_changed', publishedAt: null });
  });

  it('produces no event when the transaction rolls back', async () => {
    let id = '';
    await expect(
      withTenant(tenant(), async (tx) => {
        id = await emit(tx, 'membership.status_changed', payload());
        throw new Error('use case failed after emitting');
      }),
    ).rejects.toThrow('use case failed');
    expect(id).not.toBe('');
    expect(await eventRows([id])).toEqual([]);
  });

  it('refuses to run outside withTenant', async () => {
    await expect(withUser(userId, (tx) => emit(tx, 'membership.status_changed', payload()))).rejects.toThrow(
      'inside withTenant',
    );
    await expect(withPlatform((tx) => emit(tx, 'membership.status_changed', payload()))).rejects.toThrow(
      'inside withTenant',
    );
  });

  it('validates the payload against the catalog', async () => {
    const bad = { ...payload(), membershipId: 'nope' };
    await expect(withTenant(tenant(), (tx) => emit(tx, 'membership.status_changed', bad))).rejects.toThrow();
  });

  it('is append-only for the app role', async () => {
    const err = await withTenant(tenant(), (tx) => tx.select().from(schema.outboxEvents)).catch((e: unknown) => e);
    expect(String((err as { cause?: unknown }).cause)).toContain('permission denied');
  });
});

describe('outbox relay', () => {
  it('sends one job per consumer and marks the events published, exactly once', async () => {
    const ids = await withTenant(tenant(), async (tx) => [
      await emit(tx, 'membership.status_changed', payload()),
      await emit(tx, 'membership.status_changed', payload()),
    ]);
    await relayOutboxBatch(boss, consumers, 1000);
    await relayOutboxBatch(boss, consumers, 1000);

    expect((await eventRows(ids)).every((r) => r.publishedAt !== null)).toBe(true);
    for (const c of consumers) expect(await jobsFor(consumerQueue(c), ids)).toHaveLength(2);
  });

  it('loses nothing when the worker dies mid-batch', async () => {
    const id = await withTenant(tenant(), (tx) => emit(tx, 'membership.status_changed', payload()));
    const dying: JobSink = {
      async insert(name: string, jobs: JobInsert[], options) {
        await boss.insert(name, jobs, options); // first queue written inside the relay transaction...
        throw new Error('worker died'); // ...then the process "dies"
      },
    };
    await expect(relayOutboxBatch(dying, consumers, 1000)).rejects.toThrow('worker died');
    const [afterCrash] = await eventRows([id]);
    expect(afterCrash?.publishedAt).toBeNull();
    expect(await jobsFor(consumerQueue(recorder), [id])).toHaveLength(0); // rolled back with it

    await relayOutboxBatch(boss, consumers, 1000);
    const [afterRetry] = await eventRows([id]);
    expect(afterRetry?.publishedAt).not.toBeNull();
    expect(await jobsFor(consumerQueue(recorder), [id])).toHaveLength(1);
  });
});

describe('consumers', () => {
  async function deliver() {
    const id = await withTenant(tenant(), (tx) => emit(tx, 'membership.status_changed', payload()));
    await relayOutboxBatch(boss, consumers, 1000);
    const [job] = await jobsFor(consumerQueue(recorder), [id]);
    if (!job) throw new Error('job not relayed');
    return { id, data: job.data };
  }

  it('handles a redelivered event once', async () => {
    const { id, data } = await deliver();
    expect(await runConsumer(recorder, data)).toBe('handled');
    expect(await runConsumer(recorder, data)).toBe('duplicate');
    expect(handled.filter((e) => e.id === id)).toHaveLength(1);
  });

  it('retries after a failed handler, because the consumption mark rolls back too', async () => {
    const { id, data } = await deliver();
    failNext = true;
    await expect(runConsumer(recorder, data)).rejects.toThrow('handler failed');
    expect(await runConsumer(recorder, data)).toBe('handled');
    expect(handled.filter((e) => e.id === id)).toHaveLength(1);
  });

  it('rejects job data that does not match the consumer event', async () => {
    await expect(runConsumer(recorder, { hello: 'world' })).rejects.toThrow();
  });

  it('flows end to end through the worker loop', async () => {
    const outbox = await startOutbox(boss, consumers, pino({ level: 'silent' }), {
      intervalMs: 100,
      pollingIntervalSeconds: 0.5,
    });
    try {
      const id = await withTenant(tenant(), (tx) => emit(tx, 'membership.status_changed', payload()));
      await vi.waitFor(() => expect(handled.some((e) => e.id === id)).toBe(true), { timeout: 10_000, interval: 100 });
      expect(await boss.getQueue(consumerQueue(recorder))).toMatchObject({ retryLimit: 5, deadLetter: 'outbox.dead' });
    } finally {
      await outbox.stop();
      for (const c of consumers) await boss.offWork(consumerQueue(c));
    }
  });
});

describe('membership status endpoint', () => {
  it('emits membership.status_changed with the request id as trace, once per effect', async () => {
    const a = await t.staff('Admin Outbox');
    await t.member(school, a.id, 'admin');
    const admin = t.agent();
    await signIn(admin, a.email).expect(200);
    await enableTotp(admin);
    const target = await t.staff('Target Outbox');
    const membershipId = await t.member(school, target.id, 'guru');

    const send = () =>
      admin
        .patch(`/api/v1/school/members/${membershipId}`)
        .set('X-School-Id', school)
        .set('Idempotency-Key', `outbox-${membershipId}`)
        .send({ status: 'suspended' })
        .expect(200);
    const res = await send();
    await send(); // replay

    const rows = await getDb()
      .db.select()
      .from(schema.outboxEvents)
      .where(sql`${schema.outboxEvents.payload}->>'membershipId' = ${membershipId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'membership.status_changed',
      traceId: res.headers['x-request-id'],
      payload: { membershipId, userId: target.id, from: 'active', to: 'suspended' },
    });
  });
});

describe('inbox_webhooks', () => {
  it('stores each provider message once', async () => {
    const externalId = `wamid.${uuidv7()}`;
    const first = await recordWebhook('whatsapp', externalId, { status: 'delivered' });
    const again = await recordWebhook('whatsapp', externalId, { status: 'delivered' });
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ id: first.id, duplicate: true });
    expect((await recordWebhook('payment', externalId, {})).duplicate).toBe(false);

    expect(await markWebhookProcessed(first.id)).toBe(true);
    expect(await markWebhookProcessed(first.id)).toBe(false);
  });

  it('is invisible to the app role', async () => {
    const err = await withTenant(tenant(), (tx) => tx.select().from(schema.inboxWebhooks)).catch((e: unknown) => e);
    expect(String((err as { cause?: unknown }).cause)).toContain('permission denied');
  });
});

describe('retention', () => {
  it('deletes only events published more than 7 days ago', async () => {
    const [oldId, newId] = await withTenant(tenant(), async (tx) => [
      await emit(tx, 'membership.status_changed', payload()),
      await emit(tx, 'membership.status_changed', payload()),
    ]);
    const { db } = getDb();
    await db
      .update(schema.outboxEvents)
      .set({ publishedAt: sql`now() - interval '8 days'` })
      .where(eq(schema.outboxEvents.id, oldId));
    await db.update(schema.outboxEvents).set({ publishedAt: sql`now()` }).where(eq(schema.outboxEvents.id, newId));

    const deleted = await deleteOldOutboxRows();
    expect(deleted.events).toBeGreaterThanOrEqual(1);
    expect((await eventRows([oldId, newId])).map((r) => r.id)).toEqual([newId]);
  });
});
