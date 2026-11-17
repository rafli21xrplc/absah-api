import { schema } from '@absah/db';
import { PILOT_EMAIL_DOMAIN, PILOT_NPSN } from '@absah/db/seed';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findScheduleConflicts } from '../src/modules/academic/domain/schedule-conflicts';
import { findSchool, generateForSchool } from '../src/modules/attendance';
import { seedPilot } from '../src/modules/platform';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { buildTestApp, signIn } from './harness';

const t = buildTestApp();
const { config } = t;
const PASSWORD = 'pilot-password-for-tests';

/** The pilot has fixed NPSN and emails: remove what an earlier run left behind. */
async function removePilot() {
  const { db } = getDb();
  await db.delete(schema.schools).where(eq(schema.schools.npsn, PILOT_NPSN));
  await db.delete(schema.user).where(like(schema.user.email, `%@${PILOT_EMAIL_DOMAIN}`));
}

let schoolId = '';
let seconds = 0;
beforeAll(async () => {
  await removePilot();
  const started = Date.now();
  const result = await seedPilot(t.auth, { password: PASSWORD, hashKey: config.HASH_KEY, appRole: config.DB_APP_ROLE });
  seconds = (Date.now() - started) / 1000;
  if (!result.created) throw new Error('pilot was not created');
  schoolId = result.schoolId;
}, 180_000);
afterAll(async () => {
  await removePilot();
  await t.cleanup();
});

const tenant = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ schoolId, userId: null }, fn);

describe('pilot:seed', () => {
  it('seeds from nothing in under 2 minutes, once', async () => {
    expect(seconds).toBeLessThan(120);
    expect(await seedPilot(t.auth, { password: PASSWORD, hashKey: config.HASH_KEY, appRole: config.DB_APP_ROLE })).toEqual({ created: false, schoolId });
    const counts = await tenant(async (tx) => ({
      classes: (await tx.select().from(schema.classes)).length,
      enrollments: (await tx.select().from(schema.enrollments).where(eq(schema.enrollments.status, 'active'))).length,
      guardians: (await tx.select().from(schema.guardians)).length,
      groups: (await tx.select().from(schema.learningGroups)).length,
    }));
    expect(counts).toEqual({ classes: 36, enrollments: 900, guardians: 900, groups: 32 });
  });

  it('stores a timetable the schedule checks accept', async () => {
    const { slots, enrollments, members } = await tenant(async (tx) => ({
      slots: await tx.select().from(schema.scheduleSlots),
      enrollments: await tx.select().from(schema.enrollments),
      members: await tx.select().from(schema.learningGroupMembers),
    }));
    const studentsOf = (o: { ownerType: string; ownerId: string }) =>
      new Set(o.ownerType === 'class' ? enrollments.filter((e) => e.classId === o.ownerId).map((e) => e.id) : members.filter((m) => m.learningGroupId === o.ownerId).map((m) => m.enrollmentId));
    expect(findScheduleConflicts(slots, studentsOf)).toEqual([]);
  });

  it('lets the parallel run of X-1 start on Monday 11 January 2027', async () => {
    const school = await withPlatform((tx) => findSchool(tx, schoolId));
    if (!school) throw new Error('no school');
    await generateForSchool(school, '2027-01-11', new Date('2027-01-10T22:00:00Z'));
    const [x1] = await tenant((tx) => tx.select().from(schema.classes).where(eq(schema.classes.name, 'X-1')));
    const sessions = await tenant((tx) =>
      tx
        .select()
        .from(schema.attendanceSessions)
        .where(and(eq(schema.attendanceSessions.schoolDate, '2027-01-11'), eq(schema.attendanceSessions.ownerId, x1?.id ?? ''))),
    );
    expect(sessions).toHaveLength(9);
    expect(new Set(sessions.map((s) => s.mode))).toEqual(new Set(['per_period']));

    // Its teacher logs in with the pilot password.
    const teacher = await getDb().db.select().from(schema.user).where(eq(schema.user.id, sessions[0]?.teacherId ?? ''));
    await signIn(t.agent(), teacher[0]?.email ?? '', PASSWORD).expect(200);
  });
});
