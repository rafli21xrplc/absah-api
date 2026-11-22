import { schema, type Tx } from '@absah/db';
import type { TeacherAttendanceSource } from '@absah/contracts';
import { and, eq } from 'drizzle-orm';

const a = schema.teacherAttendance;

export async function findAttendance(tx: Tx, userId: string, schoolDate: string) {
  const [row] = await tx
    .select()
    .from(a)
    .where(and(eq(a.userId, userId), eq(a.schoolDate, schoolDate)));
  return row;
}

/** The first check-in of the day wins: a second one (a resend, a second tap) inserts nothing. */
export async function insertCheckIn(tx: Tx, row: { id: string; schoolId: string; userId: string; schoolDate: string; checkedInAt: Date; late: boolean; source: TeacherAttendanceSource }): Promise<void> {
  await tx.insert(a).values(row).onConflictDoNothing();
}

export async function setCheckOut(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(a).set({ checkedOutAt: at }).where(eq(a.id, id));
}
