import type { PickupGuardianStatus, PickupRelation } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { and, asc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';

const pg = schema.pickupGuardians;
/** Qualified by hand: inside a raw subquery drizzle would print a bare column name. */
const studentCol = sql.raw('"pickup_guardians"."student_id"');

/** The student's rombel this year (null without an active enrollment). */
export const classNameOf = (student: SQL) => sql<string | null>`(
  select c.name from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
    join classes c on c.id = e.class_id
   where e.student_id = ${student} and e.status = 'active' limit 1)`;

/** The user is wali kelas of the student's active rombel. */
export const homeroomOf = (student: SQL, userId: string) => sql<boolean>`exists (
  select 1 from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
    join classes c on c.id = e.class_id
   where e.student_id = ${student} and e.status = 'active' and c.homeroom_teacher_id = ${userId}::uuid)`;

export interface StudentRelation {
  name: string;
  guardian: boolean;
  homeroom: boolean;
}

/** How the user relates to the student; undefined for an unknown student. */
export async function relationTo(tx: Tx, studentId: string, userId: string): Promise<StudentRelation | undefined> {
  const id = sql`${studentId}::uuid`;
  const res = await tx.execute<{ name: string; guardian: boolean; homeroom: boolean }>(sql`
    select st.name,
           exists (select 1 from student_guardians sg join guardians g on g.id = sg.guardian_id
                    where sg.student_id = st.id and g.user_id = ${userId}::uuid) as guardian,
           ${homeroomOf(id, userId)} as homeroom
      from students st where st.id = ${id}`);
  return res.rows[0];
}

const columns = {
  id: pg.id,
  studentId: pg.studentId,
  studentName: schema.students.name,
  className: classNameOf(studentCol),
  name: pg.name,
  relation: pg.relation,
  phone: pg.phone,
  status: pg.status,
  validUntil: pg.validUntil,
  photoKey: pg.photoKey,
  photoRemovedAt: pg.photoRemovedAt,
  createdAt: pg.createdAt,
  decidedAt: pg.decidedAt,
};

const base = (tx: Tx) => tx.select(columns).from(pg).innerJoin(schema.students, eq(schema.students.id, pg.studentId));
export type PickupGuardianRow = Awaited<ReturnType<ReturnType<typeof base>['execute']>>[number];

export function guardiansOfStudent(tx: Tx, studentId: string) {
  return base(tx).where(eq(pg.studentId, studentId)).orderBy(asc(pg.status), asc(pg.createdAt));
}

/** The queue by status, oldest first; `homeroomUserId` limits it to that wali kelas's rombel. */
export function guardiansByStatus(tx: Tx, status: PickupGuardianStatus, homeroomUserId: string | null) {
  const where = homeroomUserId ? and(eq(pg.status, status), homeroomOf(studentCol, homeroomUserId)) : eq(pg.status, status);
  return base(tx).where(where).orderBy(asc(pg.createdAt));
}

export async function findGuardian(tx: Tx, id: string): Promise<PickupGuardianRow | undefined> {
  const [row] = await base(tx).where(eq(pg.id, id));
  return row;
}

export async function lockGuardian(tx: Tx, id: string) {
  const [row] = await tx.select({ id: pg.id, studentId: pg.studentId, status: pg.status }).from(pg).where(eq(pg.id, id)).for('update');
  return row;
}

/** Pending and approved entries of the student (the cap counts these). */
export const openCount = (tx: Tx, studentId: string) => tx.$count(pg, and(eq(pg.studentId, studentId), inArray(pg.status, ['pending', 'approved'])));

export async function insertGuardian(
  tx: Tx,
  row: { id: string; schoolId: string; studentId: string; name: string; relation: PickupRelation; phone: string; photoKey: string; validUntil: string | null; status: 'pending' | 'approved'; registeredBy: string; now: Date },
) {
  const { phone, now, ...rest } = row;
  const decided = row.status === 'approved' ? { decidedBy: row.registeredBy, decidedAt: now } : {};
  await tx.insert(pg).values({ ...rest, phone: sensitive(phone), ...decided });
}

export async function setStatus(tx: Tx, id: string, status: PickupGuardianStatus, userId: string, now: Date) {
  const decided = status === 'approved' || status === 'rejected' ? { decidedBy: userId, decidedAt: now } : {};
  const ended = status === 'rejected' || status === 'inactive' ? { endedAt: now } : {};
  await tx.update(pg).set({ status, ...decided, ...ended }).where(eq(pg.id, id));
}

/** Photos of entries that ended before the cutoff and are still stored (across schools). */
export function photosDueForRemoval(tx: Tx, cutoff: Date) {
  return tx.select({ id: pg.id, photoKey: pg.photoKey }).from(pg).where(and(isNull(pg.photoRemovedAt), lt(pg.endedAt, cutoff)));
}

export async function markPhotoRemoved(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(pg).set({ photoRemovedAt: at }).where(eq(pg.id, id));
}
