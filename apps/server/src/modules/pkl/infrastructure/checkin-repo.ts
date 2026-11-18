import { schema, type Tx } from '@absah/db';
import { and, asc, eq, sql } from 'drizzle-orm';

const c = schema.pklCheckins;

/**
 * The running placement of the student whose PWA login is `userId` on `date` (not cancelled, active
 * enrollment, period covers the date), with its DUDI and that weekday's hours. One at most: overlaps
 * are refused when placements are written.
 */
export async function studentPlacementOn(tx: Tx, userId: string, date: string) {
  const res = await tx.execute<{
    placement_id: string;
    enrollment_id: string;
    starts_on: string;
    ends_on: string;
    industry_mentor_id: string | null;
    school_mentor_name: string | null;
    industry_mentor_name: string | null;
    partner_name: string;
    address: string;
    latitude: number;
    longitude: number;
    radius_m: number;
    starts_at: string | null;
    ends_at: string | null;
  }>(sql`
    select p.id as placement_id, p.enrollment_id, p.starts_on::text, p.ends_on::text, p.industry_mentor_id,
           (select d.name from school_member_directory d where d.user_id = p.school_mentor_id limit 1) as school_mentor_name,
           (select d.name from school_member_directory d where d.user_id = p.industry_mentor_id limit 1) as industry_mentor_name,
           dp.name as partner_name, dp.address, dp.latitude, dp.longitude, dp.radius_m,
           h.starts_at::text, h.ends_at::text
      from students s
      join enrollments e on e.student_id = s.id and e.status = 'active'
      join pkl_placements p on p.enrollment_id = e.id and p.status = 'active'
      join dudi_partners dp on dp.id = p.partner_id
      left join dudi_work_hours h on h.partner_id = dp.id and h.day = extract(isodow from ${date}::date)
     where s.user_id = ${userId}::uuid and p.starts_on <= ${date}::date and p.ends_on >= ${date}::date
     order by p.starts_on desc
     limit 1`);
  const r = res.rows[0];
  if (!r) return undefined;
  return {
    placementId: r.placement_id,
    enrollmentId: r.enrollment_id,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    industryMentorId: r.industry_mentor_id,
    schoolMentorName: r.school_mentor_name,
    industryMentorName: r.industry_mentor_name,
    partner: { name: r.partner_name, address: r.address, latitude: r.latitude, longitude: r.longitude, radiusM: r.radius_m },
    hours: r.starts_at && r.ends_at ? { startsAt: r.starts_at.slice(0, 5), endsAt: r.ends_at.slice(0, 5) } : null,
  };
}
export type StudentPlacement = NonNullable<Awaited<ReturnType<typeof studentPlacementOn>>>;

/** Inserts a check-in/out; undefined when that kind already exists for the placement and date. */
export async function insertCheckin(tx: Tx, values: typeof c.$inferInsert): Promise<string | undefined> {
  const [row] = await tx.insert(c).values(values).onConflictDoNothing({ target: [c.placementId, c.schoolDate, c.kind] }).returning({ id: c.id });
  return row?.id;
}

export function checkinsOf(tx: Tx, placementId: string, date: string) {
  return tx
    .select({
      id: c.id,
      kind: c.kind,
      schoolDate: c.schoolDate,
      recordedAt: c.recordedAt,
      distanceM: c.distanceM,
      reviewReasons: c.reviewReasons,
      late: c.late,
      confirmStatus: c.confirmStatus,
      decidedStatus: c.decidedStatus,
    })
    .from(c)
    .where(and(eq(c.placementId, placementId), eq(c.schoolDate, date)))
    .orderBy(asc(c.kind));
}
export type CheckinRow = Awaited<ReturnType<typeof checkinsOf>>[number];
