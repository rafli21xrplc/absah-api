import { schema, sensitive } from '@absah/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { audit, type AuditContext } from '../src/shared/audit';
import { hashValue } from '../src/shared/crypto';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

async function setup() {
  const school = await t.school('sd', 'SD Audit');
  const guru = await t.staff('Guru Audit');
  await t.member(school, guru.id, 'wali_kelas');
  const ctx: AuditContext = { schoolId: school, actorUserId: guru.id, requestId: 'req-audit-1', ip: '198.51.100.23' };
  return { school, guru, ctx };
}

const rowsFor = (school: string) =>
  getDb().db.select().from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school)); // owner read, test only

describe('audit()', () => {
  it('writes a sanitised entry in the caller transaction', async () => {
    const { school, guru, ctx } = await setup();
    await withTenant({ schoolId: school, userId: guru.id }, (tx) =>
      audit(
        tx,
        ctx,
        'pickup_guardian.approved',
        { type: 'pickup_guardian', id: 'pg-1' },
        {
          before: { status: 'pending', name: 'Pak Budi', phone: '+6281200000001' },
          after: { status: 'approved', name: 'Pak Budi', phone: sensitive('+6281200000001') },
        },
      ),
    );
    const [row] = await rowsFor(school);
    expect(row).toMatchObject({
      actorUserId: guru.id,
      action: 'pickup_guardian.approved',
      entity: 'pickup_guardian',
      entityId: 'pg-1',
      requestId: 'req-audit-1',
      before: { status: 'pending', name: '[redacted]', phone: '[redacted]' },
      after: { status: 'approved', name: '[redacted]', phone: '[redacted]' },
    });
    expect(row?.ipHash).toBe(hashValue('198.51.100.23'));
    expect(JSON.stringify(row)).not.toContain('198.51.100.23');
  });

  it('is rolled back together with the change it describes', async () => {
    const { school, guru, ctx } = await setup();
    await expect(
      withTenant({ schoolId: school, userId: guru.id }, async (tx) => {
        await audit(tx, ctx, 'leave_request.approved', { type: 'leave_request', id: 'lr-1' });
        throw new Error('use case failed after auditing');
      }),
    ).rejects.toThrow('use case failed');
    expect(await rowsFor(school)).toEqual([]);
  });

  it('can omit the IP entirely (anonymous TPPK reports)', async () => {
    const { school, guru, ctx } = await setup();
    await withTenant({ schoolId: school, userId: guru.id }, (tx) =>
      audit(tx, ctx, 'tppk_report.received', { type: 'tppk_report' }, {}, { omitIp: true }),
    );
    expect((await rowsFor(school))[0]?.ipHash).toBeNull();
  });

  it('rejects free-form action names', async () => {
    const { school, guru, ctx } = await setup();
    await expect(
      withTenant({ schoolId: school, userId: guru.id }, (tx) => audit(tx, ctx, 'Approved leave!', { type: 'x' })),
    ).rejects.toThrow(/entity\.verb/);
  });
});
