import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';

const m = schema.memorizationLogs;

export function insertLog(tx: Tx, row: typeof m.$inferInsert) {
  return tx.insert(m).values(row);
}

/** Newest first; the listener's name from school_member_directory (absah_app cannot read "user"). */
export async function logsOf(tx: Tx, studentId: string, limit: number) {
  const res = await tx.execute<{
    id: string;
    school_date: string;
    surah: number;
    juz: number | null;
    ayat_from: number;
    ayat_to: number;
    score: number | null;
    note: string | null;
    listener_id: string | null;
    listener_name: string | null;
    created_at: Date | string;
  }>(sql`
    select l.id, l.school_date::text as school_date, l.surah, l.juz, l.ayat_from, l.ayat_to, l.score, l.note,
           l.listener_id, (select d.name from school_member_directory d where d.user_id = l.listener_id limit 1) as listener_name,
           l.created_at
      from memorization_logs l
     where l.student_id = ${studentId}::uuid
     order by l.school_date desc, l.created_at desc
     limit ${limit}`);
  return res.rows;
}

/** Active students of the active year by name, at most 20, with their rombel. */
export function searchActiveStudents(tx: Tx, text: string) {
  const term = text.replace(/[%_\\]/g, (x) => `\\${x}`);
  const e = schema.enrollments;
  return tx
    .select({ studentId: schema.students.id, name: schema.students.name, className: schema.classes.name })
    .from(e)
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.status, 'active'), ilike(schema.students.name, `%${term}%`)))
    .orderBy(asc(schema.students.name), desc(e.startsOn))
    .limit(20);
}
