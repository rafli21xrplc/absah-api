import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import type { DbHandle } from '../src/client';
import { memberships, schools, user } from '../src/schema';
import { withTenant, withUser } from '../src/tenant';
import { testDb } from './helpers';

let h: DbHandle;
const schoolA = uuidv7();
const schoolB = uuidv7();
const schoolC = uuidv7();
const alice = uuidv7(); // admin at A, guru at B
const bob = uuidv7(); // guru at B only
const carol = uuidv7(); // suspended at C

beforeAll(async () => {
  h = testDb();
  await h.db.insert(schools).values([
    { id: schoolA, name: 'RLS A', level: 'sd' },
    { id: schoolB, name: 'RLS B', level: 'smp' },
    { id: schoolC, name: 'RLS C', level: 'sma' },
  ]);
  await h.db.insert(user).values([
    { id: alice, name: 'Alice', email: `alice-${alice}@test.local` },
    { id: bob, name: 'Bob', email: `bob-${bob}@test.local` },
    { id: carol, name: 'Carol', email: `carol-${carol}@test.local` },
  ]);
  await h.db.insert(memberships).values([
    { schoolId: schoolA, userId: alice, role: 'admin' },
    { schoolId: schoolB, userId: alice, role: 'guru' },
    { schoolId: schoolB, userId: bob, role: 'guru' },
    { schoolId: schoolC, userId: carol, role: 'guru', status: 'suspended' },
  ]);
});

afterAll(async () => {
  await h.db.execute(sql`delete from schools where id in (${schoolA}, ${schoolB}, ${schoolC})`);
  await h.db.execute(sql`delete from "user" where id in (${alice}, ${bob}, ${carol})`);
  await h.close();
});

describe('memberships RLS', () => {
  it('withUser sees only the user own memberships, across schools', async () => {
    const rows = await withUser(h.db, alice, (tx) =>
      tx.select({ schoolId: memberships.schoolId, userId: memberships.userId }).from(memberships),
    );
    expect(rows.map((r) => r.schoolId).sort()).toEqual([schoolA, schoolB].sort());
    expect(rows.every((r) => r.userId === alice)).toBe(true);
  });

  it('withUser sees the schools the user actively belongs to, not others', async () => {
    const aliceSchools = await withUser(h.db, alice, (tx) => tx.select({ id: schools.id }).from(schools));
    expect(aliceSchools.map((s) => s.id).sort()).toEqual([schoolA, schoolB].sort());
    const carolSchools = await withUser(h.db, carol, (tx) => tx.select({ id: schools.id }).from(schools));
    expect(carolSchools).toEqual([]); // suspended membership grants no school visibility
  });

  it('withTenant sees all members of the active school only', async () => {
    const rows = await withTenant(h.db, { schoolId: schoolB, userId: bob }, (tx) =>
      tx.select({ schoolId: memberships.schoolId }).from(memberships),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.schoolId === schoolB)).toBe(true);
  });

  it('cannot create a membership in another school', async () => {
    await expect(
      withTenant(h.db, { schoolId: schoolA, userId: alice }, (tx) =>
        tx.insert(memberships).values({ schoolId: schoolB, userId: alice, role: 'admin' }),
      ),
    ).rejects.toThrow();
  });

  it('member directory exposes names of the active school members only', async () => {
    const rows = await withTenant(h.db, { schoolId: schoolA, userId: alice }, async (tx) =>
      (await tx.execute(sql`select user_id, name from school_member_directory`)).rows as { user_id: string; name: string }[],
    );
    expect(rows).toEqual([{ user_id: alice, name: 'Alice' }]);
  });

  it('the app role cannot read credential tables', async () => {
    for (const table of ['user', 'account', 'session', 'two_factor']) {
      const err = await withTenant(h.db, { schoolId: schoolA, userId: alice }, (tx) =>
        tx.execute(sql.raw(`select 1 from "${table}"`)),
      ).then(
        () => null,
        (e: unknown) => e,
      );
      // drizzle wraps the Postgres error; the driver error is the cause.
      expect(String((err as { cause?: unknown } | null)?.cause)).toMatch(/permission denied/);
    }
  });

  it('withUser rejects a malformed user id', async () => {
    await expect(withUser(h.db, 'nope', () => Promise.resolve(1))).rejects.toThrow(/must be a UUID/);
  });
});
