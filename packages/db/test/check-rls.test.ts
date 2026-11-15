import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/client';
import { findRlsViolations } from '../src/rls';
import { testDb } from './helpers';

let h: DbHandle;

beforeAll(() => {
  h = testDb();
});

afterAll(async () => {
  await h.db.execute(sql`drop table if exists rls_missing_probe, rls_nopolicy_probe`);
  await h.close();
});

describe('db:check-rls', () => {
  it('passes on the migrated schema', async () => {
    expect(await findRlsViolations(h.pool, 'absah_app')).toEqual([]);
  });

  it('flags a tenant table without RLS and one without a policy', async () => {
    await h.db.execute(sql`create table rls_missing_probe (id int primary key, school_id uuid not null)`);
    await h.db.execute(sql`create table rls_nopolicy_probe (id int primary key, school_id uuid not null)`);
    await h.db.execute(sql`alter table rls_nopolicy_probe enable row level security`);

    const violations = await findRlsViolations(h.pool, 'absah_app');
    expect(violations).toEqual(
      expect.arrayContaining([
        { table: 'public.rls_missing_probe', problem: 'rls_disabled' },
        { table: 'public.rls_nopolicy_probe', problem: 'no_policy' },
      ]),
    );
  });

  it('flags a missing app role', async () => {
    expect(await findRlsViolations(h.pool, 'role_that_does_not_exist')).toContainEqual({
      table: 'role:role_that_does_not_exist',
      problem: 'app_role_missing',
    });
  });
});
