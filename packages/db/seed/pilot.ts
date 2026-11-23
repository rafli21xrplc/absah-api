// Writes pilotPlan() into an empty database school (prompt 4.4). Staff accounts live in Better Auth,
// so the caller creates them first (apps/server `pilot:seed`) and passes their user ids.
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db, Tx } from '../src/client';
import { keyedHash, sensitive } from '../src/crypto';
import { schools } from '../src/schema/platform';
import * as schema from '../src/schema';
import { withPlatform, withTenant } from '../src/tenant';
import { PILOT_NPSN, type PilotPlan } from './pilot-plan';

export * from './pilot-plan';

const CHUNK = 1000;
async function insertAll<T extends Record<string, unknown>>(tx: Tx, table: Parameters<Tx['insert']>[0], rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(table).values(rows.slice(i, i + CHUNK));
}

/** The pilot school, if it was seeded already. withPlatform: looked up before any tenant exists. */
export async function findPilotSchool(db: Db): Promise<string | null> {
  const [row] = await withPlatform(db, (tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.npsn, PILOT_NPSN)));
  return row?.id ?? null;
}

export interface PilotCounts {
  schoolId: string;
  classes: number;
  students: number;
  staff: number;
  groups: number;
  slots: number;
}

/**
 * One transaction as the new school (RLS allows inserting the school row whose id is the tenant).
 * `userIds` maps every plan.staff key to its account; `hashKey` is HASH_KEY (guardians.phone_hash).
 */
export function writePilot(db: Db, plan: PilotPlan, userIds: Record<string, string>, hashKey: string, options: { appRole?: string } = {}): Promise<PilotCounts> {
  const schoolId = uuidv7();
  const user = (key: string) => {
    const id = userIds[key];
    if (!id) throw new Error(`no account for staff ${key}`);
    return id;
  };

  return withTenant(db, { schoolId, userId: null }, async (tx) => {
    await tx.insert(schema.schools).values({ id: schoolId, ...plan.school });
    await tx.insert(schema.schoolSetup).values({ schoolId, steps: { profile: 'done', level: 'done', mbg: 'skipped', import: 'done', gate: 'skipped', invite: 'done' }, completedAt: new Date() });
    const academicYearId = uuidv7();
    await tx.insert(schema.academicYears).values({ id: academicYearId, schoolId, ...plan.year, isActive: true });
    await tx.insert(schema.semesters).values(plan.semesters.map((s) => ({ schoolId, academicYearId, ...s })));
    await tx.insert(schema.schedulePeriods).values(plan.periods.map((p) => ({ schoolId, ...p })));

    const subjectIds = new Map(plan.subjects.map((s) => [s.code, uuidv7()]));
    await tx.insert(schema.subjects).values(plan.subjects.map((s) => ({ id: subjectIds.get(s.code), schoolId, ...s })));
    const subject = (code: string) => subjectIds.get(code) ?? '';

    await insertAll(
      tx,
      schema.memberships,
      plan.staff.flatMap((s) => s.roles.map((role) => ({ schoolId, userId: user(s.key), role, status: 'active' as const }))),
    );

    const classIds = new Map(plan.classes.map((c) => [c.name, uuidv7()]));
    await tx.insert(schema.classes).values(
      plan.classes.map((c) => ({ id: classIds.get(c.name), schoolId, academicYearId, name: c.name, grade: c.grade, stream: c.stream, homeroomTeacherId: user(c.homeroom) })),
    );

    const studentIds = new Map(plan.students.map((s) => [s.nisn, uuidv7()]));
    const enrollmentIds = new Map(plan.students.map((s) => [s.nisn, uuidv7()]));
    const guardianIds = new Map(plan.students.map((s) => [s.nisn, uuidv7()]));
    await insertAll(
      tx,
      schema.students,
      plan.students.map((s) => ({ id: studentIds.get(s.nisn), schoolId, name: s.name, nisn: s.nisn, localId: s.localId, gender: s.gender, birthDate: s.birthDate })),
    );
    await insertAll(
      tx,
      schema.enrollments,
      plan.students.map((s) => ({
        id: enrollmentIds.get(s.nisn),
        schoolId,
        studentId: studentIds.get(s.nisn) ?? '',
        classId: classIds.get(s.className) ?? '',
        academicYearId,
        startsOn: plan.year.startsOn,
      })),
    );
    await insertAll(
      tx,
      schema.guardians,
      plan.students.map((s) => ({ id: guardianIds.get(s.nisn), schoolId, name: s.guardian.name, phone: sensitive(s.guardian.phone), phoneHash: keyedHash(hashKey, s.guardian.phone) })),
    );
    await insertAll(
      tx,
      schema.studentGuardians,
      plan.students.map((s) => ({ schoolId, studentId: studentIds.get(s.nisn) ?? '', guardianId: guardianIds.get(s.nisn) ?? '', relation: s.guardian.relation, isPrimary: true })),
    );

    const groupIds = new Map(plan.groups.map((g) => [g.name, uuidv7()]));
    await tx.insert(schema.learningGroups).values(plan.groups.map((g) => ({ id: groupIds.get(g.name), schoolId, academicYearId, subjectId: subject(g.subject), teacherId: user(g.teacher), name: g.name })));
    await insertAll(
      tx,
      schema.learningGroupMembers,
      plan.groups.flatMap((g) => g.members.map((nisn) => ({ schoolId, learningGroupId: groupIds.get(g.name) ?? '', enrollmentId: enrollmentIds.get(nisn) ?? '' }))),
    );
    await insertAll(
      tx,
      schema.scheduleSlots,
      plan.slots.map((s) => ({
        schoolId,
        academicYearId,
        ownerType: s.owner.type,
        ownerId: (s.owner.type === 'class' ? classIds : groupIds).get(s.owner.name) ?? '',
        day: s.day,
        period: s.period,
        subjectId: subject(s.subject),
        teacherId: user(s.teacher),
      })),
    );

    return { schoolId, classes: plan.classes.length, students: plan.students.length, staff: plan.staff.length, groups: plan.groups.length, slots: plan.slots.length };
  }, options);
}
