import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import type { DbHandle } from '../src/client';
import { configureEncryption, encryptedText, parseKeyring, sensitive } from '../src/crypto';
import { auditLogs, memberships, schools, user } from '../src/schema';
import { withTenant } from '../src/tenant';
import { testDb } from './helpers';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

// Probe table following the pattern future sensitive columns will use (UKS notes, BK notes, ...).
const secretProbe = pgTable('secret_probe', {
  id: uuid('id').primaryKey(),
  schoolId: uuid('school_id').notNull(),
  note: encryptedText('note', 'secret_probe.note').notNull(),
});

let h: DbHandle;
const school = uuidv7();
const admin = uuidv7();
const guru = uuidv7();
const exAdmin = uuidv7();

beforeAll(async () => {
  h = testDb();
  configureEncryption(parseKeyring(`k1:${k1}`, 'k1'));
  await h.db.insert(schools).values({ id: school, name: 'Audit', level: 'smp' });
  await h.db.insert(user).values([
    { id: admin, name: 'Admin', email: `a-${admin}@test.local` },
    { id: guru, name: 'Guru', email: `g-${guru}@test.local` },
    { id: exAdmin, name: 'Mantan', email: `x-${exAdmin}@test.local` },
  ]);
  await h.db.insert(memberships).values([
    { schoolId: school, userId: admin, role: 'admin' },
    { schoolId: school, userId: guru, role: 'guru' },
    { schoolId: school, userId: exAdmin, role: 'admin', status: 'suspended' },
  ]);
  await h.db.execute(sql`create table secret_probe (id uuid primary key, school_id uuid not null, note text not null)`);
  await h.db.execute(sql`create index secret_probe_school_idx on secret_probe (school_id)`);
  await h.db.execute(sql`alter table secret_probe enable row level security`);
  await h.db.execute(sql`create policy tenant_isolation on secret_probe
    using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
    with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid)`);
  await h.db.execute(sql`grant select, insert, update, delete on secret_probe to absah_app`);
});

afterAll(async () => {
  await h.db.execute(sql`drop table if exists secret_probe`);
  await h.db.delete(schools).where(eq(schools.id, school));
  await h.db.execute(sql`delete from "user" where id in (${admin}, ${guru}, ${exAdmin})`);
  await h.close();
});

describe('encryptedText column', () => {
  it('stores ciphertext and returns SensitiveText that reveals the plaintext', async () => {
    const id = uuidv7();
    await withTenant(h.db, { schoolId: school, userId: guru }, (tx) =>
      tx.insert(secretProbe).values({ id, schoolId: school, note: sensitive('Pusing, istirahat di UKS') }),
    );

    const raw = await h.db.execute(sql`select note from secret_probe where id = ${id}`);
    const stored = (raw.rows[0] as { note: string }).note;
    expect(stored).toMatch(/^v1:k1:/);
    expect(stored).not.toContain('Pusing');

    const [row] = await withTenant(h.db, { schoolId: school, userId: guru }, (tx) =>
      tx.select().from(secretProbe).where(eq(secretProbe.id, id)),
    );
    expect(row?.note.reveal()).toBe('Pusing, istirahat di UKS');
    expect(JSON.stringify(row)).not.toContain('Pusing');
  });

  it('keeps reading old rows after key rotation and writes new rows with the new key', async () => {
    const oldId = uuidv7();
    await withTenant(h.db, { schoolId: school, userId: guru }, (tx) =>
      tx.insert(secretProbe).values({ id: oldId, schoolId: school, note: sensitive('lama') }),
    );

    configureEncryption(parseKeyring(`k2:${k2},k1:${k1}`, 'k2'));
    const newId = uuidv7();
    await withTenant(h.db, { schoolId: school, userId: guru }, (tx) =>
      tx.insert(secretProbe).values({ id: newId, schoolId: school, note: sensitive('baru') }),
    );
    const rows = await withTenant(h.db, { schoolId: school, userId: guru }, (tx) => tx.select().from(secretProbe));
    const byId = new Map(rows.map((r) => [r.id, r.note.reveal()]));
    expect(byId.get(oldId)).toBe('lama');
    expect(byId.get(newId)).toBe('baru');
    const raw = await h.db.execute(sql`select note from secret_probe where id = ${newId}`);
    expect((raw.rows[0] as { note: string }).note).toMatch(/^v1:k2:/);
  });
});

describe('audit_logs RLS', () => {
  const insertEntry = (userId: string, action: string) =>
    withTenant(h.db, { schoolId: school, userId }, (tx) =>
      tx.insert(auditLogs).values({ schoolId: school, actorUserId: userId, action, entity: 'probe' }),
    );
  const readAs = (userId: string) =>
    withTenant(h.db, { schoolId: school, userId }, (tx) => tx.select({ action: auditLogs.action }).from(auditLogs));

  it('lets any member write, but only an active admin read', async () => {
    await insertEntry(guru, 'probe.by_guru');
    await insertEntry(admin, 'probe.by_admin');
    expect((await readAs(guru)).length).toBe(0);
    expect((await readAs(exAdmin)).length).toBe(0);
    expect((await readAs(admin)).map((r) => r.action).sort()).toEqual(['probe.by_admin', 'probe.by_guru']);
  });

  it('is append-only: even an admin cannot update or delete entries', async () => {
    for (const statement of [sql`update audit_logs set action = 'x'`, sql`delete from audit_logs`]) {
      const err = await withTenant(h.db, { schoolId: school, userId: admin }, (tx) => tx.execute(statement)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(String((err as { cause?: unknown } | null)?.cause)).toMatch(/permission denied/);
    }
  });

  it('cannot write entries for another school', async () => {
    await expect(
      withTenant(h.db, { schoolId: school, userId: admin }, (tx) =>
        tx.insert(auditLogs).values({ schoolId: uuidv7(), action: 'x', entity: 'probe' }),
      ),
    ).rejects.toThrow();
  });
});
