import { schema, sensitive, type Tx } from '@absah/db';
import type { CounselingFollowUp } from '@absah/contracts';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const c = schema.counselingNotes;
const e = schema.enrollments;

export async function activeStudent(tx: Tx, enrollmentId: string) {
  const [row] = await tx
    .select({ enrollmentId: e.id })
    .from(e)
    .where(and(eq(e.id, enrollmentId), eq(e.status, 'active')));
  return row;
}

export interface NewNote {
  id: string;
  schoolId: string;
  enrollmentId: string;
  sessionDate: string;
  note: string;
  followUp: CounselingFollowUp;
  followUpOn: string | null;
  recordedBy: string;
}

export async function insertNote(tx: Tx, row: NewNote): Promise<void> {
  // No RETURNING from here: the row is read back through findNote, which the policy allows for the writer.
  await tx.insert(c).values({ ...row, note: sensitive(row.note) });
}

const recorder = directoryName(c.recordedBy);

const columns = {
  id: c.id,
  enrollmentId: c.enrollmentId,
  name: schema.students.name,
  className: schema.classes.name,
  sessionDate: c.sessionDate,
  note: c.note,
  followUp: c.followUp,
  followUpOn: c.followUpOn,
  followedUpAt: c.followedUpAt,
  recordedById: c.recordedBy,
  recordedByName: recorder,
};

function notes(tx: Tx) {
  return tx
    .select(columns)
    .from(c)
    .innerJoin(e, eq(e.id, c.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId));
}

export type NoteRow = Awaited<ReturnType<typeof listNotes>>[number];

export async function findNote(tx: Tx, id: string): Promise<NoteRow | undefined> {
  const [row] = await notes(tx).where(eq(c.id, id));
  return row;
}

/** Newest first, at most 200. */
export function listNotes(tx: Tx, filter: { enrollmentId?: string; followUp?: CounselingFollowUp }) {
  const where: SQL[] = [];
  if (filter.enrollmentId) where.push(eq(c.enrollmentId, filter.enrollmentId));
  if (filter.followUp) where.push(eq(c.followUp, filter.followUp));
  return notes(tx)
    .where(and(...where))
    .orderBy(desc(c.sessionDate), desc(c.createdAt), desc(c.id))
    .limit(200);
}

/** planned to done; false when it was not planned (or not visible), so two completions cannot both win. */
export async function completeFollowUp(tx: Tx, id: string, at: Date): Promise<boolean> {
  const done = await tx.update(c).set({ followUp: 'done', followedUpAt: at }).where(and(eq(c.id, id), eq(c.followUp, 'planned'))).returning({ id: c.id });
  return done.length > 0;
}
