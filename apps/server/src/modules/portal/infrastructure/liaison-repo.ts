import { schema, sensitive, type Tx } from '@absah/db';
import { asc, eq, sql, type SQL } from 'drizzle-orm';

const th = schema.communicationThreads;
const msg = schema.communicationMessages;

/**
 * The user teaches the student this year: wali kelas of the active enrollment's rombel, or teacher
 * of a lesson of that rombel or of a learning group the student is in. `student` is a qualified
 * column or a bound id (a bare column name would bind inside the subquery).
 */
const teaches = (student: SQL, userId: string) => sql`exists (
  select 1 from enrollments e
    join academic_years y on y.id = e.academic_year_id and y.is_active
    join classes c on c.id = e.class_id
   where e.student_id = ${student} and e.status = 'active'
     and (c.homeroom_teacher_id = ${userId}::uuid
       or exists (select 1 from schedule_slots sl
                   where sl.academic_year_id = e.academic_year_id and sl.teacher_id = ${userId}::uuid
                     and ((sl.owner_type = 'class' and sl.owner_id = e.class_id)
                       or (sl.owner_type = 'group' and exists (select 1 from learning_group_members m
                                                                where m.learning_group_id = sl.owner_id and m.enrollment_id = e.id))))))`;

const guards = (student: SQL, userId: string) => sql`exists (
  select 1 from student_guardians sg join guardians g on g.id = sg.guardian_id
   where sg.student_id = ${student} and g.user_id = ${userId}::uuid)`;

export interface Relation {
  guardian: boolean;
  homeroom: boolean;
  teacher: boolean;
}

/** How the user is linked to the student now (none of them: not a participant). */
export async function relationOf(tx: Tx, studentId: string, userId: string): Promise<Relation> {
  const id = sql`${studentId}::uuid`;
  const res = await tx.execute<{ guardian: boolean; homeroom: boolean; teacher: boolean }>(sql`
    select ${guards(id, userId)} as guardian,
           exists (select 1 from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
                     join classes c on c.id = e.class_id
                    where e.student_id = ${id} and e.status = 'active' and c.homeroom_teacher_id = ${userId}::uuid) as homeroom,
           ${teaches(id, userId)} as teacher`);
  const row = res.rows[0];
  return { guardian: row?.guardian ?? false, homeroom: row?.homeroom ?? false, teacher: row?.teacher ?? false };
}

/** Name and current rombel (null without an active enrollment). */
export async function studentInfo(tx: Tx, studentId: string) {
  const res = await tx.execute<{ id: string; name: string; class_name: string | null }>(sql`
    select st.id, st.name,
           (select c.name from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
              join classes c on c.id = e.class_id where e.student_id = st.id and e.status = 'active' limit 1) as class_name
      from students st where st.id = ${studentId}::uuid`);
  const row = res.rows[0];
  return row ? { id: row.id, name: row.name, className: row.class_name } : undefined;
}

export async function threadIdOf(tx: Tx, studentId: string): Promise<string | undefined> {
  const [row] = await tx.select({ id: th.id }).from(th).where(eq(th.studentId, studentId));
  return row?.id;
}

export async function ensureThread(tx: Tx, schoolId: string, studentId: string): Promise<string> {
  await tx.insert(th).values({ schoolId, studentId }).onConflictDoNothing();
  const id = await threadIdOf(tx, studentId);
  if (!id) throw new Error('thread vanished');
  return id;
}

export function messagesOf(tx: Tx, threadId: string) {
  return tx
    .select({
      id: msg.id,
      senderId: msg.senderId,
      senderName: sql<string | null>`(select d.name from school_member_directory d where d.user_id = "communication_messages"."sender_id" limit 1)`,
      senderRole: msg.senderRole,
      body: msg.body,
      createdAt: msg.createdAt,
      retractedAt: msg.retractedAt,
    })
    .from(msg)
    .where(eq(msg.threadId, threadId))
    .orderBy(asc(msg.createdAt), asc(msg.id));
}

export async function insertMessage(tx: Tx, row: { id: string; schoolId: string; threadId: string; senderId: string; senderRole: 'orang_tua' | 'wali_kelas' | 'guru'; body: string }) {
  const [inserted] = await tx
    .insert(msg)
    .values({ ...row, body: sensitive(row.body) })
    .returning({ createdAt: msg.createdAt });
  await tx.update(th).set({ lastMessageAt: inserted?.createdAt ?? new Date() }).where(eq(th.id, row.threadId));
}

export async function lockMessage(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: msg.id, senderId: msg.senderId, createdAt: msg.createdAt, retractedAt: msg.retractedAt, threadId: msg.threadId, studentId: th.studentId })
    .from(msg)
    .innerJoin(th, eq(th.id, msg.threadId))
    .where(eq(msg.id, id))
    .for('update', { of: msg });
  return row;
}

export async function retractMessage(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(msg).set({ retractedAt: at }).where(eq(msg.id, id));
}

export async function markRead(tx: Tx, schoolId: string, threadId: string, userId: string, at: Date): Promise<void> {
  await tx
    .insert(schema.communicationReads)
    .values({ schoolId, threadId, userId, readAt: at })
    .onConflictDoUpdate({ target: [schema.communicationReads.threadId, schema.communicationReads.userId], set: { readAt: at } });
}

/**
 * Threads the user sees, newest first. parent: every child with an active enrollment (also without
 * messages yet); staff: threads with messages of students they teach; admin: every thread with messages.
 */
export async function threadsFor(tx: Tx, userId: string, as: 'parent' | 'staff' | 'admin') {
  const student = sql`st.id`;
  const where = as === 'parent' ? guards(student, userId) : as === 'staff' ? sql`t.last_message_at is not null and ${teaches(student, userId)}` : sql`t.last_message_at is not null`;
  const res = await tx.execute<{ student_id: string; name: string; class_name: string | null; last_message_at: Date | null; unread: number }>(sql`
    select st.id as student_id, st.name,
           (select c.name from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
              join classes c on c.id = e.class_id where e.student_id = st.id and e.status = 'active' limit 1) as class_name,
           t.last_message_at,
           (select count(*)::int from communication_messages m
             where m.thread_id = t.id and m.retracted_at is null and m.sender_id is distinct from ${userId}::uuid
               and m.created_at > coalesce((select r.read_at from communication_reads r where r.thread_id = t.id and r.user_id = ${userId}::uuid), '-infinity'::timestamptz)) as unread
      from students st
      left join communication_threads t on t.student_id = st.id
     where ${where}
       ${as === 'parent' ? sql`and exists (select 1 from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active where e.student_id = st.id and e.status = 'active')` : sql``}
     order by t.last_message_at desc nulls last, st.name, st.id
     limit 200`);
  return res.rows.map((r) => ({
    studentId: r.student_id,
    studentName: r.name,
    className: r.class_name,
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
    unread: r.unread ?? 0,
  }));
}
