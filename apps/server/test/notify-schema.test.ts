import { TEMPLATE_CODES } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let a: string;
let b: string;
beforeAll(async () => {
  a = await t.school('sd', 'SD Notif A');
  b = await t.school('sd', 'SD Notif B');
});

const row = (schoolId: string, dedupKey: string) => ({
  schoolId,
  dedupKey,
  templateCode: 'absent_marked',
  toPhone: sensitive('+6281234567890'),
  params: sensitive(JSON.stringify({ first_name: 'Ani' })),
});

describe('notify schema', () => {
  it('isolates notifications per school, dedups per key and encrypts phone and parameters', async () => {
    await withTenant({ schoolId: a, userId: null }, async (tx) => {
      await tx.insert(schema.notifications).values(row(a, 'absent:e1:2026-11-16:g1'));
      const again = await tx.insert(schema.notifications).values(row(a, 'absent:e1:2026-11-16:g1')).onConflictDoNothing().returning();
      expect(again).toHaveLength(0);
    });
    const other = await withTenant({ schoolId: b, userId: null }, (tx) => tx.select().from(schema.notifications));
    expect(other).toHaveLength(0);
    const raw = await getDb().db.execute<{ to_phone: string; params: string }>(sql`select to_phone, params from notifications where school_id = ${a}`);
    expect(raw.rows[0]?.to_phone).not.toContain('628');
    expect(raw.rows[0]?.params).not.toContain('Ani');
    await expect(withTenant({ schoolId: b, userId: null }, (tx) => tx.insert(schema.notifications).values(row(a, 'x')))).rejects.toThrow();
  });

  it('ships the templates read-only for the app role', async () => {
    const templates = await withTenant({ schoolId: a, userId: null }, (tx) =>
      tx.select({ code: schema.messageTemplates.code, params: schema.messageTemplates.params }).from(schema.messageTemplates).orderBy(schema.messageTemplates.code),
    );
    // Every template code the product sends has a row.
    expect(templates.map((x) => x.code)).toEqual([...TEMPLATE_CODES].sort());
    await expect(
      withTenant({ schoolId: a, userId: null }, (tx) => tx.update(schema.messageTemplates).set({ approval: 'approved' }).where(eq(schema.messageTemplates.code, 'login_otp'))),
    ).rejects.toThrow();
  });
});
