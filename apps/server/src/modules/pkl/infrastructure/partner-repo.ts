import { STAFF_ROLES, type DudiWorkDay } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

const p = schema.dudiPartners;
const h = schema.dudiWorkHours;
const e = schema.enrollments;

export async function activeYear(tx: Tx) {
  const [row] = await tx.select({ id: schema.academicYears.id }).from(schema.academicYears).where(eq(schema.academicYears.isActive, true)).limit(1);
  return row;
}

/** Placements not cancelled that run today or later. */
const activePlacements = (today: string) =>
  sql<number>`(select count(*)::int from pkl_placements pp where pp.partner_id = ${p.id} and pp.status = 'active' and pp.ends_on >= ${today}::date)`;

export function listPartners(tx: Tx, today: string, opts: { id?: string } = {}) {
  return tx
    .select({
      id: p.id,
      name: p.name,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      radiusM: p.radiusM,
      active: p.active,
      activePlacements: activePlacements(today),
    })
    .from(p)
    .where(opts.id ? eq(p.id, opts.id) : undefined)
    .orderBy(asc(p.name), asc(p.id));
}

export async function workHoursOf(tx: Tx, partnerIds: string[]): Promise<Map<string, DudiWorkDay[]>> {
  const out = new Map<string, DudiWorkDay[]>();
  if (partnerIds.length === 0) return out;
  const rows = await tx
    .select({ partnerId: h.partnerId, day: h.day, startsAt: h.startsAt, endsAt: h.endsAt })
    .from(h)
    .where(inArray(h.partnerId, partnerIds))
    .orderBy(asc(h.partnerId), asc(h.day));
  for (const r of rows) {
    out.set(r.partnerId, [...(out.get(r.partnerId) ?? []), { day: r.day, startsAt: r.startsAt.slice(0, 5), endsAt: r.endsAt.slice(0, 5) }]);
  }
  return out;
}

export async function insertPartner(tx: Tx, values: typeof p.$inferInsert): Promise<void> {
  await tx.insert(p).values(values);
}

export async function updatePartner(tx: Tx, id: string, values: Partial<typeof p.$inferInsert>): Promise<void> {
  await tx.update(p).set({ ...values, updatedAt: new Date() }).where(eq(p.id, id));
}

export async function replaceWorkHours(tx: Tx, schoolId: string, partnerId: string, days: DudiWorkDay[]): Promise<void> {
  await tx.delete(h).where(eq(h.partnerId, partnerId));
  await tx.insert(h).values(days.map((d) => ({ schoolId, partnerId, day: d.day, startsAt: d.startsAt, endsAt: d.endsAt })));
}

/** Active students of the year by name or NISN, at most 20. */
export function searchStudents(tx: Tx, academicYearId: string, text: string) {
  const term = `%${text.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
  return tx
    .select({ studentId: schema.students.id, enrollmentId: e.id, name: schema.students.name, nisn: schema.students.nisn, className: schema.classes.name })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.academicYearId, academicYearId), eq(e.status, 'active'), or(ilike(schema.students.name, term), ilike(schema.students.nisn, term))))
    .orderBy(asc(schema.students.name), asc(e.id))
    .limit(20);
}

/** School staff: STAFF_ROLES without the industry supervisors (they are not school staff). */
const SCHOOL_STAFF = STAFF_ROLES.filter((r) => r !== 'pembimbing_industri');
const staffRoleIn = sql.join(SCHOOL_STAFF.map((r) => sql`${r}`), sql`, `);

/** Active school staff (guru pembimbing candidates), by name; `userIds` limits the check to them. */
export async function activeStaff(tx: Tx, userIds?: string[]): Promise<{ id: string; name: string }[]> {
  if (userIds?.length === 0) return [];
  const only = userIds ? sql`and d.user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const res = await tx.execute<{ user_id: string; name: string }>(sql`
    select distinct on (d.user_id) d.user_id, d.name from school_member_directory d
     where d.status = 'active' and d.role in (${staffRoleIn}) ${only}
     order by d.user_id`);
  return res.rows.map((r) => ({ id: r.user_id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}
