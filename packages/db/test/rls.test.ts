import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import type { DbHandle } from '../src/client';
import { schools } from '../src/schema';
import { withTenant } from '../src/tenant';
import { testDb } from './helpers';

// tenant_probe follows the same pattern every tenant table must follow.
let h: DbHandle;
const schoolA = uuidv7();
const schoolB = uuidv7();

beforeAll(async () => {
  h = testDb();
  await h.db.insert(schools).values([
    { id: schoolA, name: 'Probe A', level: 'sd' },
    { id: schoolB, name: 'Probe B', level: 'smk' },
  ]);
  await h.db.execute(sql`create table tenant_probe (
    id uuid primary key, school_id uuid not null, note text not null)`);
  await h.db.execute(sql`create index tenant_probe_school_idx on tenant_probe (school_id)`);
  await h.db.execute(sql`alter table tenant_probe enable row level security`);
  await h.db.execute(sql`create policy tenant_isolation on tenant_probe
    using (school_id = current_setting('app.school_id')::uuid)
    with check (school_id = current_setting('app.school_id')::uuid)`);
  await h.db.execute(sql`grant select, insert, update, delete on tenant_probe to absah_app`);
  await h.db.execute(sql`insert into tenant_probe values
    (${uuidv7()}, ${schoolA}, 'a1'), (${uuidv7()}, ${schoolA}, 'a2'), (${uuidv7()}, ${schoolB}, 'b1')`);
});

afterAll(async () => {
  await h.db.execute(sql`drop table if exists tenant_probe`);
  await h.db.execute(sql`delete from schools where id in (${schoolA}, ${schoolB})`);
  await h.close();
});

type ProbeRow = { school_id: string; note: string };
const probeRows = (r: { rows: Record<string, unknown>[] }) => r.rows as ProbeRow[];

describe('withTenant + RLS', () => {
  it('school A only sees its own rows', async () => {
    const rows = await withTenant(h.db, { schoolId: schoolA, userId: null }, async (tx) =>
      probeRows(await tx.execute(sql`select school_id, note from tenant_probe order by note`)),
    );
    expect(rows.map((r) => r.note)).toEqual(['a1', 'a2']);
    expect(rows.every((r) => r.school_id === schoolA)).toBe(true);
  });

  it('school B never sees school A rows, even when filtering for them', async () => {
    const rows = await withTenant(h.db, { schoolId: schoolB, userId: null }, async (tx) =>
      probeRows(await tx.execute(sql`select school_id, note from tenant_probe where school_id = ${schoolA}`)),
    );
    expect(rows).toEqual([]);
  });

  it('rejects writes into another school', async () => {
    await expect(
      withTenant(h.db, { schoolId: schoolA, userId: null }, (tx) =>
        tx.execute(sql`insert into tenant_probe values (${uuidv7()}, ${schoolB}, 'sneaky')`),
      ),
    ).rejects.toThrow();
  });

  it('schools table is scoped to the active school', async () => {
    const visible = await withTenant(h.db, { schoolId: schoolA, userId: null }, (tx) =>
      tx.select({ id: schools.id }).from(schools),
    );
    expect(visible.map((s) => s.id)).toEqual([schoolA]);
  });

  it('fails closed outside withTenant when running as the app role', async () => {
    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`set local role absah_app`);
        return tx.execute(sql`select * from tenant_probe`);
      }),
    ).rejects.toThrow();
  });

  it('settings do not leak to the next transaction on the same pool', async () => {
    await withTenant(h.db, { schoolId: schoolA, userId: null }, () => Promise.resolve());
    const r = await h.db.execute(sql`select current_setting('app.school_id', true) as v, current_user as u`);
    const row = r.rows[0] as { v: string | null; u: string };
    expect(row.v ?? '').toBe('');
    expect(row.u).not.toBe('absah_app');
  });

  it('rejects malformed ids before touching the database', async () => {
    await expect(withTenant(h.db, { schoolId: "x'; drop table schools; --", userId: null }, () => Promise.resolve(1))).rejects.toThrow(
      /must be a UUID/,
    );
  });
});
