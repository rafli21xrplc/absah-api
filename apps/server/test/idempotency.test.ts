import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteExpiredIdempotencyKeys } from '../src/modules/platform';
import { getDb, withTenant } from '../src/shared/db';
import { IDEMPOTENCY_TTL_MS } from '../src/shared/idempotency';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let otherSchool: string;
let adminId: string;
let admin: Agent;
let guru: Agent;
let adminMembership: string;
let otherMembership: string;

beforeAll(async () => {
  school = await t.school('smp', 'SMP Idempoten');
  otherSchool = await t.school('smp', 'SMP Lain');
  const a = await t.staff('Admin Idempoten');
  adminId = a.id;
  adminMembership = await t.member(school, a.id, 'admin');
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);

  const g = await t.staff('Guru Idempoten');
  await t.member(school, g.id, 'guru');
  guru = t.agent();
  await signIn(guru, g.email).expect(200);

  const other = await t.staff('Guru Sekolah Lain');
  otherMembership = await t.member(otherSchool, other.id, 'guru');
});

const key = () => `test-${uuidv7()}`;

async function newMember(status: 'active' | 'invited' = 'active') {
  const u = await t.staff('Anggota');
  return t.member(school, u.id, 'guru', status);
}

function patch(agent: Agent, membershipId: string, body: unknown, idemKey?: string) {
  const req = agent.patch(`/api/v1/school/members/${membershipId}`).set('X-School-Id', school);
  if (idemKey !== undefined) req.set('Idempotency-Key', idemKey);
  return req.send(body as object);
}

const auditRows = (membershipId: string) =>
  getDb()
    .db.select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.entityId, membershipId)));

describe('idempotent()', () => {
  it('requires a well-formed Idempotency-Key', async () => {
    const m = await newMember();
    const missing = await patch(admin, m, { status: 'suspended' }).expect(400);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'Idempotency-Key' }] });
    await patch(admin, m, { status: 'suspended' }, 'short').expect(400);
    await patch(admin, m, { status: 'suspended' }, 'bad key with spaces').expect(400);
  });

  it('replays the stored response for a retry and applies the change once', async () => {
    const m = await newMember();
    const k = key();
    const first = await patch(admin, m, { status: 'suspended' }, k).expect(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(first.body).toMatchObject({ membershipId: m, status: 'suspended' });

    // Someone reactivates in between; the replay must not suspend again.
    await patch(admin, m, { status: 'active' }, key()).expect(200);
    const retry = await patch(admin, m, { status: 'suspended' }, k).expect(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);

    const actions = (await auditRows(m)).map((r) => r.after);
    expect(actions).toEqual([{ status: 'suspended' }, { status: 'active' }]);
  });

  it('treats the same body with reordered keys as the same request', async () => {
    const m = await newMember();
    const k = key();
    await admin
      .patch(`/api/v1/school/members/${m}`)
      .set('X-School-Id', school)
      .set('Idempotency-Key', k)
      .set('Content-Type', 'application/json')
      .send('{"status":"suspended"}')
      .expect(200);
    const again = await patch(admin, m, { status: 'suspended' }, k).expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects the same key with a different body (422)', async () => {
    const m = await newMember();
    const k = key();
    await patch(admin, m, { status: 'suspended' }, k).expect(200);
    const res = await patch(admin, m, { status: 'active' }, k).expect(422);
    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('answers 409 while the first request is still running, and takes over an abandoned one', async () => {
    const m = await newMember();
    const k = key();
    const first = await patch(admin, m, { status: 'suspended' }, k).expect(200);
    // Simulate "still running" by reopening the stored row.
    const reopen = (lockedUntil: Date) =>
      getDb()
        .db.update(schema.idempotencyKeys)
        .set({ status: 'in_progress', responseStatus: null, responseBody: null, lockedUntil })
        .where(and(eq(schema.idempotencyKeys.schoolId, school), eq(schema.idempotencyKeys.key, k)));

    await reopen(new Date(Date.now() + 60_000));
    const busy = await patch(admin, m, { status: 'suspended' }, k).expect(409);
    expect(busy.body).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });

    await reopen(new Date(Date.now() - 1_000));
    const takenOver = await patch(admin, m, { status: 'suspended' }, k).expect(200);
    expect(takenOver.headers['idempotent-replayed']).toBeUndefined();
    expect(takenOver.body).toEqual(first.body);
    expect(await auditRows(m)).toHaveLength(1); // already suspended: no second effect
  });

  it('lets only one of two concurrent identical requests run', async () => {
    const m = await newMember();
    const k = key();
    const results = await Promise.all([
      patch(admin, m, { status: 'suspended' }, k),
      patch(admin, m, { status: 'suspended' }, k),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect([[200, 200], [200, 409]]).toContainEqual(statuses);
    expect(await auditRows(m)).toHaveLength(1);
  });

  it('stores 4xx answers and replays them too', async () => {
    const m = await newMember();
    const k = key();
    await patch(admin, m, { status: 'invited' }, k).expect(400);
    const again = await patch(admin, m, { status: 'invited' }, k).expect(400);
    expect(again.headers['idempotent-replayed']).toBe('true');
  });

  it('keeps stored responses encrypted and private to the caller', async () => {
    const m = await newMember();
    const k = key();
    await patch(admin, m, { status: 'suspended' }, k).expect(200);
    const [raw] = await getDb()
      .db.execute<{ response_body: string }>(
        // owner read of the raw column, test only
        `select response_body from idempotency_keys where key = '${k}'`,
      )
      .then((r) => r.rows);
    expect(raw?.response_body).toMatch(/^v1:test1:/);
    expect(raw?.response_body).not.toContain(m);

    const visibleTo = (userId: string | null, schoolId = school) =>
      withTenant({ schoolId, userId }, (tx) =>
        tx.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, k)),
      );
    expect(await visibleTo(adminId)).toHaveLength(1);
    expect(await visibleTo(uuidv7())).toHaveLength(0);
    expect(await visibleTo(null)).toHaveLength(0);
    expect(await visibleTo(adminId, otherSchool)).toHaveLength(0);
  });

  it('cleanup deletes only expired keys', async () => {
    const m = await newMember();
    const live = key();
    const old = key();
    await patch(admin, m, { status: 'suspended' }, live).expect(200);
    await patch(admin, m, { status: 'active' }, old).expect(200);
    await getDb()
      .db.update(schema.idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS) })
      .where(eq(schema.idempotencyKeys.key, old));

    expect(await deleteExpiredIdempotencyKeys()).toBeGreaterThanOrEqual(1);
    const left = await getDb().db.select({ key: schema.idempotencyKeys.key }).from(schema.idempotencyKeys);
    expect(left.map((r) => r.key)).toContain(live);
    expect(left.map((r) => r.key)).not.toContain(old);
  });
});

describe('PATCH /school/members/:membershipId', () => {
  it('is admin only', async () => {
    const m = await newMember();
    const res = await patch(guru, m, { status: 'suspended' }, key()).expect(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses to change your own membership', async () => {
    await patch(admin, adminMembership, { status: 'suspended' }, key()).expect(403);
  });

  it('cannot activate an invitation that was not accepted', async () => {
    const m = await newMember('invited');
    const res = await patch(admin, m, { status: 'active' }, key()).expect(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('cannot see memberships of another school', async () => {
    await patch(admin, otherMembership, { status: 'suspended' }, key()).expect(404);
  });

  it('suspension takes effect on the next request of that member', async () => {
    const u = await t.staff('Guru Diskors');
    const m = await t.member(school, u.id, 'guru');
    const victim = t.agent();
    await signIn(victim, u.email).expect(200);
    await victim.get('/api/v1/me/context').set('X-School-Id', school).expect(200);
    await patch(admin, m, { status: 'suspended' }, key()).expect(200);
    await victim.get('/api/v1/me/context').set('X-School-Id', school).expect(403);
  });
});
