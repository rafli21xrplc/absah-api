import type { CardHolder } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, exists, isNull, sql } from 'drizzle-orm';

const st = schema.students;
const c = schema.cards;
const d = schema.cardDevices;

/** Students whose card this user holds: their own (student) or their children's (parent). */
export function heldStudents(tx: Tx, userId: string, holder: CardHolder) {
  const isHolder =
    holder === 'student'
      ? eq(st.userId, userId)
      : exists(
          tx
            .select({ one: sql`1` })
            .from(schema.studentGuardians)
            .innerJoin(schema.guardians, eq(schema.guardians.id, schema.studentGuardians.guardianId))
            .where(and(eq(schema.studentGuardians.studentId, st.id), eq(schema.guardians.userId, userId))),
        );
  const e = schema.enrollments;
  return tx
    .select({ studentId: st.id, name: st.name, className: schema.classes.name, cardId: c.id, activeDeviceId: c.activeDeviceId })
    .from(st)
    .innerJoin(e, and(eq(e.studentId, st.id), eq(e.status, 'active')))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .leftJoin(c, eq(c.studentId, st.id))
    .where(isHolder)
    .orderBy(asc(st.name));
}

/** The student's card (created on first bind), locked so two binds cannot race. */
export async function lockCard(tx: Tx, schoolId: string, studentId: string) {
  await tx.insert(c).values({ schoolId, studentId }).onConflictDoNothing();
  const [row] = await tx.select().from(c).where(eq(c.studentId, studentId)).for('update');
  if (!row) throw new Error('card missing');
  return row;
}

/** Binds a new phone: previous devices are revoked, the card points at the new one. */
export async function bindDevice(tx: Tx, card: { id: string; schoolId: string }, values: { deviceId: string; holder: CardHolder; userId: string; label: string | null }) {
  await tx.update(d).set({ revokedAt: sql`now()` }).where(and(eq(d.cardId, card.id), isNull(d.revokedAt)));
  await tx.insert(d).values({ id: values.deviceId, schoolId: card.schoolId, cardId: card.id, holder: values.holder, userId: values.userId, label: values.label });
  await tx.update(c).set({ activeDeviceId: values.deviceId }).where(eq(c.id, card.id));
}

/** A device still bound to its card, with who bound it. */
export async function activeDevice(tx: Tx, deviceId: string) {
  const [row] = await tx
    .select({ deviceId: d.id, cardId: d.cardId, userId: d.userId })
    .from(d)
    .innerJoin(c, and(eq(c.id, d.cardId), eq(c.activeDeviceId, d.id)))
    .where(and(eq(d.id, deviceId), isNull(d.revokedAt)));
  return row;
}
