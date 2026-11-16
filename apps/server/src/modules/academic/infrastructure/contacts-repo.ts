import { schema, sensitive, type Tx } from '@absah/db';
import { and, asc, desc, eq } from 'drizzle-orm';

const st = schema.students;
const e = schema.enrollments;

/** The student with their active-year class and wali kelas; the row is locked for an update. */
export async function studentForContacts(tx: Tx, studentId: string, lock: boolean) {
  const query = tx
    .select({ id: st.id, name: st.name, userId: st.userId, className: schema.classes.name, homeroomTeacherId: schema.classes.homeroomTeacherId })
    .from(st)
    .leftJoin(e, eq(e.studentId, st.id))
    .leftJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .leftJoin(schema.classes, and(eq(schema.classes.id, e.classId), eq(schema.classes.academicYearId, schema.academicYears.id)))
    .where(eq(st.id, studentId))
    .orderBy(desc(schema.academicYears.isActive), desc(e.startsOn))
    .limit(1);
  const [row] = lock ? await query.for('update', { of: st }) : await query;
  return row;
}

export function guardiansOfStudent(tx: Tx, studentId: string) {
  const g = schema.guardians;
  return tx
    .select({ id: g.id, name: g.name, phone: g.phone, relation: schema.studentGuardians.relation })
    .from(schema.studentGuardians)
    .innerJoin(g, eq(g.id, schema.studentGuardians.guardianId))
    .where(eq(schema.studentGuardians.studentId, studentId))
    .orderBy(asc(schema.studentGuardians.relation), asc(g.name));
}

export async function setGuardianPhone(tx: Tx, guardianId: string, phone: string | null, phoneHash: string | null) {
  await tx
    .update(schema.guardians)
    .set({ phone: phone ? sensitive(phone) : null, phoneHash })
    .where(eq(schema.guardians.id, guardianId));
}

export const setStudentUser = (tx: Tx, studentId: string, userId: string) => tx.update(st).set({ userId }).where(eq(st.id, studentId));
