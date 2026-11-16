import { schema, sensitive } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

async function seed(name: string) {
  const school = await t.school('smp', name);
  return withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '7A', grade: 7 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'BAYU' }).returning();
    const [enrollment] = await tx
      .insert(schema.enrollments)
      .values({ schoolId: school, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })
      .returning();
    await tx.insert(schema.gateSecrets).values({ schoolId: school, secret: sensitive('c2VjcmV0') });
    const [card] = await tx.insert(schema.cards).values({ schoolId: school, studentId: student?.id ?? '' }).returning();
    await tx.insert(schema.cardDevices).values({ schoolId: school, cardId: card?.id ?? '', holder: 'student' });
    const [kiosk] = await tx.insert(schema.kioskDevices).values({ schoolId: school, name: 'Gerbang depan', tokenHash: 'h' }).returning();
    await tx.insert(schema.kioskPairings).values({ schoolId: school, secretHash: 'p', expiresAt: new Date(Date.now() + 600_000) });
    const scan = { schoolId: school, schoolDate: '2026-11-17', scannedAt: new Date(), method: 'qr' as const, result: 'accepted' as const, outcome: 'on_time' as const };
    await tx.insert(schema.gateScans).values({ ...scan, enrollmentId: enrollment?.id ?? '', cardId: card?.id ?? '', kioskDeviceId: kiosk?.id ?? '', clientEventId: uuidv7() });
    return { school, enrollmentId: enrollment?.id ?? '', kioskId: kiosk?.id ?? '', scan };
  });
}

describe('gate tables', () => {
  it('are isolated per school', async () => {
    await seed('SMP Gerbang 1');
    const two = await seed('SMP Gerbang 2');
    await withTenant({ schoolId: two.school, userId: null }, async (tx) => {
      for (const table of [schema.gateSecrets, schema.cards, schema.cardDevices, schema.kioskDevices, schema.kioskPairings, schema.gateScans]) {
        const rows = await tx.select({ schoolId: table.schoolId }).from(table);
        expect(rows.map((r) => r.schoolId)).toEqual([two.school]);
      }
    });
  });

  it('keep one arrival per student per day, unique client events per kiosk, and an append-only log', async () => {
    const s = await seed('SMP Gerbang Unik');
    const scope = { schoolId: s.school, userId: null };
    await expect(withTenant(scope, (tx) => tx.insert(schema.gateScans).values({ ...s.scan, enrollmentId: s.enrollmentId }))).rejects.toThrow();
    // A duplicate arrival is fine as long as it is not "accepted".
    await withTenant(scope, (tx) => tx.insert(schema.gateScans).values({ ...s.scan, result: 'duplicate', enrollmentId: s.enrollmentId }));
    const clientEventId = uuidv7();
    const rejected = { ...s.scan, result: 'rejected' as const, outcome: null, rejectReason: 'expired' as const, kioskDeviceId: s.kioskId, clientEventId };
    await withTenant(scope, (tx) => tx.insert(schema.gateScans).values(rejected));
    await expect(withTenant(scope, (tx) => tx.insert(schema.gateScans).values(rejected))).rejects.toThrow();
    await expect(withTenant(scope, (tx) => tx.update(schema.gateScans).set({ reason: 'x' }).where(eq(schema.gateScans.schoolId, s.school)))).rejects.toThrow();
    await expect(withTenant(scope, (tx) => tx.delete(schema.gateScans).where(eq(schema.gateScans.schoolId, s.school)))).rejects.toThrow();
  });
});
