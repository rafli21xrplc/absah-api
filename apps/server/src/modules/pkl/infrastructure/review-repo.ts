import type { AttendanceStatus, PklConfirmStatus, PklReviewReason } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';

/**
 * The open review queue: pkl sessions whose check-in waits for the school (needs_review, disputed),
 * and past work days with no check-in and no status at all. Reads attendance_sessions/records directly
 * (like activity recaps); writes go through the attendance module.
 */
export async function reviewQueue(tx: Tx, today: string, schoolMentorId?: string) {
  const mine = schoolMentorId ? sql`and p.school_mentor_id = ${schoolMentorId}::uuid` : sql``;
  const res = await tx.execute<{
    session_id: string;
    school_date: string;
    placement_id: string;
    student_id: string;
    student_name: string;
    class_name: string;
    partner_id: string;
    partner_name: string;
    checkin_id: string | null;
    recorded_at: string | null;
    distance_m: number | null;
    accuracy_m: number | null;
    review_reasons: PklReviewReason[] | null;
    late: boolean | null;
    confirm_status: PklConfirmStatus | null;
    dispute_reason: string | null;
    status: AttendanceStatus | null;
  }>(sql`
    select s.id as session_id, s.school_date::text, p.id as placement_id, st.id as student_id, st.name as student_name,
           cl.name as class_name, dp.id as partner_id, dp.name as partner_name,
           c.id as checkin_id, c.recorded_at::text, c.distance_m, c.accuracy_m, c.review_reasons::text[] as review_reasons,
           c.late, c.confirm_status::text as confirm_status, c.dispute_reason,
           r.status::text as status
      from attendance_sessions s
      join pkl_placements p on p.id = s.pkl_placement_id
      join enrollments e on e.id = p.enrollment_id
      join students st on st.id = e.student_id
      join classes cl on cl.id = e.class_id
      join dudi_partners dp on dp.id = p.partner_id
      left join pkl_checkins c on c.placement_id = p.id and c.school_date = s.school_date and c.kind = 'in'
      left join attendance_records r on r.session_id = s.id and r.enrollment_id = e.id
     where s.mode = 'pkl' ${mine}
       and (c.confirm_status in ('needs_review', 'disputed')
            or (c.id is null and r.id is null and s.school_date < ${today}::date))
     order by s.school_date, st.name, s.id
     limit 500`);
  return res.rows;
}

/** A pkl session with its placement, for a decision. */
export async function pklDay(tx: Tx, sessionId: string) {
  const s = schema.attendanceSessions;
  const p = schema.pklPlacements;
  const [row] = await tx
    .select({ sessionId: s.id, date: s.schoolDate, placementId: p.id, enrollmentId: p.enrollmentId, schoolMentorId: p.schoolMentorId })
    .from(s)
    .innerJoin(p, eq(p.id, s.pklPlacementId))
    .where(and(eq(s.id, sessionId), eq(s.mode, 'pkl')));
  return row;
}

/** The check-in of a placement on a date, locked for the decision. */
export async function lockDayCheckin(tx: Tx, placementId: string, date: string) {
  const c = schema.pklCheckins;
  const [row] = await tx
    .select({ id: c.id, confirmStatus: c.confirmStatus })
    .from(c)
    .where(and(eq(c.placementId, placementId), eq(c.schoolDate, date), eq(c.kind, 'in')))
    .for('update');
  return row;
}

export async function markDecided(tx: Tx, id: string, status: AttendanceStatus, by: string, at: Date): Promise<void> {
  const c = schema.pklCheckins;
  await tx.update(c).set({ confirmStatus: 'decided', decidedStatus: status, decidedBy: by, decidedAt: at }).where(eq(c.id, id));
}

/**
 * Today's pkl sessions not reminded yet whose student has not checked in, with the DUDI's opening
 * time that day (pkl.missing-checkin).
 */
export async function missingCheckins(tx: Tx, date: string) {
  const res = await tx.execute<{ session_id: string; starts_at: string }>(sql`
    select s.id as session_id, h.starts_at::text
      from attendance_sessions s
      join pkl_placements p on p.id = s.pkl_placement_id
      join dudi_work_hours h on h.partner_id = p.partner_id and h.day = extract(isodow from s.school_date)
     where s.mode = 'pkl' and s.school_date = ${date}::date and s.reminded_at is null
       and not exists (select 1 from pkl_checkins c where c.placement_id = p.id and c.school_date = s.school_date and c.kind = 'in')
       and not exists (select 1 from attendance_records r where r.session_id = s.id)`);
  return res.rows.map((r) => ({ sessionId: r.session_id, startsAt: r.starts_at }));
}
