import type { CreatedWebhook } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteOldWebhookDeliveries } from '../src/modules/integration';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let endpoint: string;
let otherEndpoint: string;

const register = async (agent: ReturnType<typeof t.agent>, schoolId: string) =>
  ((await agent.post('/api/v1/integrations/webhooks').set('X-School-Id', schoolId).set('Idempotency-Key', uuidv7()).send({ url: 'https://retention.example/in', events: ['leave.approved'] }).expect(201)).body as CreatedWebhook).id;

/** A stored call whose created_at / finished_at are set `daysAgo` days back (the owner role may do what the app role may not). */
async function call(schoolId: string, endpointId: string, status: 'pending' | 'delivered' | 'failed', createdDaysAgo: number, finishedDaysAgo: number | null) {
  const id = uuidv7();
  await withTenant({ schoolId, userId: null }, (tx) => tx.insert(schema.webhookDeliveries).values({ id, schoolId, endpointId, eventId: uuidv7(), eventType: 'leave.approved', payload: { leaveRequestId: uuidv7() }, status }));
  await getDb().db.execute(sql`update webhook_deliveries set created_at = now() - make_interval(days => ${createdDaysAgo}), finished_at = ${finishedDaysAgo === null ? null : sql`now() - make_interval(days => ${finishedDaysAgo})`} where id = ${id}`);
  return id;
}
const present = async (ids: string[]) => (await getDb().db.select({ id: schema.webhookDeliveries.id }).from(schema.webhookDeliveries).where(inArray(schema.webhookDeliveries.id, ids))).map((r) => r.id).sort();

beforeAll(async () => {
  [school, other] = await Promise.all([t.school('sma', 'SMA Retensi Webhook'), t.school('sma', 'SMA Retensi Lain')]);
  for (const s of [school, other]) await withTenant({ schoolId: s, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId: s, key: 'platform.openApi', value: true }));
  const agents = [];
  for (const [s, name] of [[school, 'Admin Retensi'], [other, 'Admin Retensi Lain']] as const) {
    const user = await t.staff(name);
    await t.member(s, user.id, 'admin');
    const agent = t.agent();
    await signIn(agent, user.email).expect(200);
    await enableTotp(agent);
    agents.push(agent);
  }
  endpoint = await register(agents[0] as ReturnType<typeof t.agent>, school);
  otherEndpoint = await register(agents[1] as ReturnType<typeof t.agent>, other);
});

describe('Webhook call retention (PLT-09)', () => {
  it('removes calls finished more than 30 days ago, in every school, and keeps the rest', async () => {
    const oldDelivered = await call(school, endpoint, 'delivered', 40, 40);
    const oldFailed = await call(school, endpoint, 'failed', 35, 31);
    const otherOld = await call(other, otherEndpoint, 'delivered', 50, 50);
    const recent = await call(school, endpoint, 'delivered', 5, 5);
    const justInside = await call(school, endpoint, 'failed', 31, 29);

    expect(await deleteOldWebhookDeliveries()).toBeGreaterThanOrEqual(3);
    expect(await present([oldDelivered, oldFailed, otherOld, recent, justInside])).toEqual([recent, justInside].sort());
  });

  it('a call still waiting is kept while young, and dropped once it is older than 30 days without ever finishing', async () => {
    const waiting = await call(school, endpoint, 'pending', 2, null);
    const stuck = await call(school, endpoint, 'pending', 45, null);
    await deleteOldWebhookDeliveries();
    expect(await present([waiting, stuck])).toEqual([waiting]);
  });

  it('is safe to run again: a second pass removes nothing it should keep', async () => {
    const keep = await call(school, endpoint, 'delivered', 1, 1);
    await deleteOldWebhookDeliveries();
    await deleteOldWebhookDeliveries();
    expect(await present([keep])).toEqual([keep]);
    // The address itself stays, and the app role still cannot delete a call by hand.
    expect((await getDb().db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, endpoint))).length).toBe(1);
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, keep)))).rejects.toThrow();
  });
});
