import type { ClassStream, GuardianRelation } from '@absah/contracts';
import { schema, SensitiveText, type Tx } from '@absah/db';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { IncomingStudent } from '../domain/student-matching';

/** Serialises imports of one school, so two commits never interleave. */
export async function lockStudentImports(tx: Tx, schoolId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`student_import:${schoolId}`}, 0))`);
}

export async function findAcademicYearByName(tx: Tx, name: string) {
  const [row] = await tx.select().from(schema.academicYears).where(eq(schema.academicYears.name, name));
  return row;
}

export async function createAcademicYear(tx: Tx, schoolId: string, year: { name: string; startsOn: string; endsOn: string }) {
  const [row] = await tx.insert(schema.academicYears).values({ schoolId, ...year, isActive: true }).returning();
  if (!row) throw new Error('insert academic_years returned nothing');
  const [y1] = year.startsOn.split('-');
  const y2 = String(Number(y1) + 1);
  await tx.insert(schema.semesters).values([
    { schoolId, academicYearId: row.id, number: 1, startsOn: year.startsOn, endsOn: `${y1}-12-31` },
    { schoolId, academicYearId: row.id, number: 2, startsOn: `${y2}-01-01`, endsOn: year.endsOn },
  ]);
  return row;
}

export async function activateAcademicYear(tx: Tx, id: string): Promise<void> {
  await tx.update(schema.academicYears).set({ isActive: true }).where(eq(schema.academicYears.id, id));
}

/** Rombel of a year by name; missing ones are created. */
export async function ensureClasses(
  tx: Tx,
  schoolId: string,
  academicYearId: string,
  wanted: Map<string, { grade: number; stream: ClassStream | null }>,
): Promise<{ ids: Map<string, string>; created: number }> {
  const rows = await tx
    .select({ id: schema.classes.id, name: schema.classes.name })
    .from(schema.classes)
    .where(eq(schema.classes.academicYearId, academicYearId));
  const ids = new Map(rows.map((r) => [r.name, r.id]));
  const missing = [...wanted].filter(([name]) => !ids.has(name));
  if (missing.length > 0) {
    const inserted = await tx
      .insert(schema.classes)
      .values(missing.map(([name, c]) => ({ schoolId, academicYearId, name, grade: c.grade, stream: c.stream })))
      .returning({ id: schema.classes.id, name: schema.classes.name });
    for (const r of inserted) ids.set(r.name, r.id);
  }
  return { ids, created: missing.length };
}

export function studentValues(row: IncomingStudent) {
  return {
    name: row.name,
    nisn: row.nisn,
    nik: row.nik === null ? null : new SensitiveText(row.nik),
    nikHash: row.nikHash,
    localId: row.localId,
    gender: row.gender,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate,
  };
}

export async function insertStudent(tx: Tx, schoolId: string, row: IncomingStudent): Promise<string> {
  const [inserted] = await tx.insert(schema.students).values({ schoolId, ...studentValues(row) }).returning({ id: schema.students.id });
  if (!inserted) throw new Error('insert students returned nothing');
  return inserted.id;
}

export async function updateStudent(tx: Tx, id: string, values: Partial<ReturnType<typeof studentValues>>): Promise<void> {
  if (Object.keys(values).length === 0) return;
  await tx.update(schema.students).set({ ...values, updatedAt: new Date() }).where(eq(schema.students.id, id));
}

export async function activeEnrollment(tx: Tx, studentId: string, academicYearId: string) {
  const e = schema.enrollments;
  const [row] = await tx
    .select()
    .from(e)
    .where(and(eq(e.studentId, studentId), eq(e.academicYearId, academicYearId), eq(e.status, 'active')))
    .for('update');
  return row;
}

export async function insertEnrollment(
  tx: Tx,
  values: { schoolId: string; studentId: string; classId: string; academicYearId: string; startsOn: string },
): Promise<void> {
  await tx.insert(schema.enrollments).values(values);
}

export async function updateEnrollment(tx: Tx, id: string, values: Partial<typeof schema.enrollments.$inferInsert>): Promise<void> {
  await tx.update(schema.enrollments).set({ ...values, updatedAt: new Date() }).where(eq(schema.enrollments.id, id));
}

/** Marks enrollments "calon keluar" (keeps the first time it was noticed). */
export async function flagMissing(tx: Tx, enrollmentIds: string[]): Promise<void> {
  if (enrollmentIds.length === 0) return;
  const e = schema.enrollments;
  await tx
    .update(e)
    .set({ missingSince: new Date(), updatedAt: new Date() })
    .where(and(inArray(e.id, enrollmentIds), isNull(e.missingSince)));
}

/** Students back in the file are no longer "calon keluar". */
export async function clearMissing(tx: Tx, academicYearId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  const e = schema.enrollments;
  await tx
    .update(e)
    .set({ missingSince: null, updatedAt: new Date() })
    .where(and(inArray(e.studentId, studentIds), eq(e.academicYearId, academicYearId), eq(e.status, 'active'), isNotNull(e.missingSince)));
}

/** Adds guardians for relations the student does not have yet; never renames existing ones. */
export async function addGuardians(
  tx: Tx,
  schoolId: string,
  studentId: string,
  guardians: { relation: GuardianRelation; name: string }[],
): Promise<number> {
  if (guardians.length === 0) return 0;
  const linked = await tx
    .select({ relation: schema.studentGuardians.relation })
    .from(schema.studentGuardians)
    .where(eq(schema.studentGuardians.studentId, studentId));
  const have = new Set(linked.map((l) => l.relation));
  const add = guardians.filter((g) => !have.has(g.relation));
  const primary = linked.length === 0 ? (add.find((g) => g.relation === 'ibu') ?? add[0])?.relation : undefined;
  for (const g of add) {
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId, name: g.name }).returning({ id: schema.guardians.id });
    if (!guardian) throw new Error('insert guardians returned nothing');
    await tx.insert(schema.studentGuardians).values({ schoolId, studentId, guardianId: guardian.id, relation: g.relation, isPrimary: g.relation === primary });
  }
  return add.length;
}
