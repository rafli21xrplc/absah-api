// Writes an EtlPlan into a school's active academic year (one tenant transaction).
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db, Tx } from '../src/client';
import * as schema from '../src/schema';
import { withTenant } from '../src/tenant';
import type { EtlPlan } from './project-attendance';

export class EtlError extends Error {}

async function activeYear(tx: Tx) {
  const [year] = await tx.select().from(schema.academicYears).where(eq(schema.academicYears.isActive, true));
  if (!year) throw new EtlError('Sekolah belum punya tahun ajaran aktif. Buat dulu lewat impor Dapodik atau pengaturan, lalu ulangi.');
  return year;
}

/** NISNs already in the school, so a rerun (or a Dapodik import before) never duplicates students. */
export function existingNisns(db: Db, schoolId: string, options: { appRole?: string } = {}): Promise<Set<string>> {
  return withTenant(
    db,
    { schoolId, userId: null },
    async (tx) => new Set((await tx.select({ nisn: schema.students.nisn }).from(schema.students).where(isNotNull(schema.students.nisn))).map((r) => r.nisn ?? '')),
    options,
  );
}

export interface EtlApplied {
  classesCreated: number;
  studentsCreated: number;
}

/**
 * Rombel are matched by name in the active year (missing ones created); students whose NISN exists
 * by now are skipped. Holds the student import lock so a Dapodik commit cannot run at the same time.
 */
export function applyEtl(db: Db, schoolId: string, plan: EtlPlan, options: { appRole?: string } = {}): Promise<EtlApplied> {
  return withTenant(
    db,
    { schoolId, userId: null },
    async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`student_import:${schoolId}`}, 0))`);
      const year = await activeYear(tx);
      const known = new Map(
        (await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes).where(eq(schema.classes.academicYearId, year.id))).map((c) => [c.name, c.id]),
      );
      const newClasses = plan.classes.filter((c) => !known.has(c.name)).map((c) => ({ id: uuidv7(), schoolId, academicYearId: year.id, name: c.name, grade: c.grade, stream: c.stream }));
      if (newClasses.length) await tx.insert(schema.classes).values(newClasses);
      for (const c of newClasses) known.set(c.name, c.id);

      const nisns = plan.students.map((s) => s.nisn);
      const taken = new Set(
        nisns.length
          ? (await tx.select({ nisn: schema.students.nisn }).from(schema.students).where(and(isNotNull(schema.students.nisn), inArray(schema.students.nisn, nisns)))).map((r) => r.nisn)
          : [],
      );
      const fresh = plan.students.filter((s) => !taken.has(s.nisn)).map((s) => ({ ...s, id: uuidv7() }));
      for (let i = 0; i < fresh.length; i += 1000) {
        const chunk = fresh.slice(i, i + 1000);
        await tx.insert(schema.students).values(chunk.map((s) => ({ id: s.id, schoolId, name: s.name, nisn: s.nisn, localId: s.localId, gender: s.gender, birthDate: s.birthDate })));
        await tx.insert(schema.enrollments).values(
          chunk.map((s) => ({ schoolId, studentId: s.id, classId: known.get(s.className) ?? '', academicYearId: year.id, startsOn: s.startsOn < year.startsOn ? year.startsOn : s.startsOn })),
        );
      }
      return { classesCreated: newClasses.length, studentsCreated: fresh.length };
    },
    options,
  );
}
