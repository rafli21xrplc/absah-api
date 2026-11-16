import { randomBytes } from 'node:crypto';
import { deviceDayKey, toBase64Url } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { hashValue } from '../../../shared/crypto';
import { withTenant } from '../../../shared/db';
import { schoolDate } from '../../../shared/school-date';
import { dayKeys } from '../infrastructure/gate-secret-repo';
import { schoolOf } from '../infrastructure/kiosk-repo';

export interface LoadFixture {
  kioskToken: string;
  timezone: string;
  schoolDate: string;
  cards: { cardId: string; deviceId: string; deviceKey: string }[];
}

/**
 * For load tests on dev/staging only (the CLI refuses production): a kiosk, and a bound test phone
 * for every active student without a card, with today's device keys, as load/kiosk-scans.k6.js needs.
 */
export function createLoadFixture(schoolId: string): Promise<LoadFixture> {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const school = await schoolOf(tx, schoolId);
    if (!school) throw new Error('school not found');
    const kioskId = uuidv7();
    const secret = randomBytes(32).toString('base64url');
    await tx.insert(schema.kioskDevices).values({ id: kioskId, schoolId, name: 'Load test', tokenHash: hashValue(secret) });

    const e = schema.enrollments;
    const students = await tx
      .select({ studentId: e.studentId })
      .from(e)
      .leftJoin(schema.cards, eq(schema.cards.studentId, e.studentId))
      .where(and(eq(e.status, 'active'), isNull(schema.cards.id)));
    const today = schoolDate(school.timezone);
    const dayKey = (await dayKeys(tx, schoolId, [today])).get(today);
    if (!dayKey) throw new Error('no day key');
    const cards = [];
    for (const { studentId } of students) {
      const cardId = uuidv7();
      const deviceId = uuidv7();
      await tx.insert(schema.cards).values({ id: cardId, schoolId, studentId, activeDeviceId: deviceId });
      await tx.insert(schema.cardDevices).values({ id: deviceId, schoolId, cardId, holder: 'student', label: 'load test' });
      cards.push({ cardId, deviceId, deviceKey: toBase64Url(await deviceDayKey(dayKey, deviceId)) });
    }
    return { kioskToken: `${schoolId}.${kioskId}.${secret}`, timezone: school.timezone, schoolDate: today, cards };
  });
}
