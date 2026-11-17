import type { HabitCode } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, between, eq, sql } from 'drizzle-orm';

const h = schema.habitEntries;

/** The student, their active enrollment, and how the user relates to them. */
export async function studentForHabits(tx: Tx, studentId: string, userId: string) {
  const res = await tx.execute<{ name: string; enrollment_id: string | null; class_id: string | null; guardian: boolean; self: boolean; homeroom: boolean }>(sql`
    select st.name, e.id as enrollment_id, c.id as class_id,
           exists (select 1 from student_guardians sg join guardians g on g.id = sg.guardian_id
                    where sg.student_id = st.id and g.user_id = ${userId}::uuid) as guardian,
           coalesce(st.user_id = ${userId}::uuid, false) as self,
           coalesce(c.homeroom_teacher_id = ${userId}::uuid, false) as homeroom
      from students st
      left join lateral (
        select e.id, e.class_id from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
         where e.student_id = st.id and e.status = 'active' limit 1) e on true
      left join classes c on c.id = e.class_id
     where st.id = ${studentId}::uuid`);
  const row = res.rows[0];
  return row ? { name: row.name, enrollmentId: row.enrollment_id, guardian: row.guardian, self: row.self, homeroom: row.homeroom } : undefined;
}

export function entriesOf(tx: Tx, enrollmentId: string, from: string, to: string) {
  return tx
    .select({ date: h.schoolDate, habit: h.habit, value: h.value, role: h.filledByRole, lockedAt: h.lockedAt })
    .from(h)
    .where(and(eq(h.enrollmentId, enrollmentId), between(h.schoolDate, from, to)));
}

/** Sets the given habits of one day; a locked row is never changed. */
export async function upsertEntries(tx: Tx, rows: { schoolId: string; enrollmentId: string; schoolDate: string; habit: HabitCode; value: boolean; filledBy: string; filledByRole: 'orang_tua' | 'siswa' }[]) {
  if (rows.length === 0) return;
  await tx
    .insert(h)
    .values(rows)
    .onConflictDoUpdate({
      target: [h.enrollmentId, h.schoolDate, h.habit],
      set: { value: sql`excluded.value`, filledBy: sql`excluded.filled_by`, filledByRole: sql`excluded.filled_by_role`, updatedAt: sql`now()` },
      setWhere: sql`${h.lockedAt} is null`,
    });
}

export async function classOf(tx: Tx, classId: string) {
  const [row] = await tx.select({ id: schema.classes.id, name: schema.classes.name, homeroomTeacherId: schema.classes.homeroomTeacherId }).from(schema.classes).where(eq(schema.classes.id, classId));
  return row;
}

/** Per active student of the rombel: days with any entry and ticks (value true) per habit in the range. The column in the subquery is qualified by hand. */
export function weekOfClass(tx: Tx, classId: string, from: string, to: string) {
  const e = schema.enrollments;
  return tx
    .select({
      studentId: schema.students.id,
      name: schema.students.name,
      daysFilled: sql<number>`count(distinct ${h.schoolDate})::int`,
      ticks: sql<{ habit: HabitCode; n: number }[]>`coalesce(
        (select jsonb_agg(jsonb_build_object('habit', x.habit, 'n', x.n)) from (
           select hh.habit, count(*)::int as n from habit_entries hh
            where hh.enrollment_id = "enrollments"."id" and hh.value and hh.school_date between ${from}::date and ${to}::date
            group by hh.habit) x), '[]'::jsonb)`,
    })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .leftJoin(h, and(eq(h.enrollmentId, e.id), between(h.schoolDate, from, to)))
    .where(and(eq(e.classId, classId), eq(e.status, 'active')))
    .groupBy(e.id, schema.students.id, schema.students.name)
    .orderBy(asc(schema.students.name));
}

/** keg.lock-habits: marks entries older than `days` back in each school's own date (across schools). */
export async function lockOldEntries(tx: Tx, days: number): Promise<number> {
  const res = await tx.execute(sql`
    update habit_entries he set locked_at = now()
      from schools s
     where s.id = he.school_id and he.locked_at is null
       and he.school_date < (now() at time zone s.timezone)::date - ${days}::int`);
  return res.rowCount ?? 0;
}
