import { maskPhone, type CreatePklPlacementsRequest, type IndustryMentorInput, type PklPlacement, type PklPlacementList, type UpdatePklPlacementRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { setPortalMembership, sharedPhoneLogin, type Auth } from '../../platform';
import { canManagePkl, canSeeAllPkl } from '../domain/policies';
import { activeStaff } from '../infrastructure/partner-repo';
import {
  activeEnrollments,
  activeIndustryMentors,
  currentPlacementCount,
  insertPlacements,
  isStudentLogin,
  listPlacements,
  lockPlacements,
  overlapping,
  partnerState,
  updatePlacement,
  type PlacementFilter,
  type PlacementRow,
} from '../infrastructure/placement-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const notFound = () => new NotFoundError('Penempatan PKL tidak ditemukan.');

function toPlacement(r: PlacementRow, today: string): PklPlacement {
  return {
    id: r.id,
    student: { studentId: r.studentId, enrollmentId: r.enrollmentId, name: r.studentName, className: r.className },
    partner: { id: r.partnerId, name: r.partnerName },
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    status: r.status,
    current: r.status === 'active' && r.startsOn <= today && today <= r.endsOn,
    schoolMentor: r.schoolMentorId ? { id: r.schoolMentorId, name: r.schoolMentorName ?? '' } : null,
    industryMentor: r.industryMentorId
      ? { id: r.industryMentorId, name: r.industryMentorName ?? '', phone: r.industryMentorPhone ? maskPhone(r.industryMentorPhone) : null }
      : null,
  };
}

async function one(tx: Tx, id: string, today: string): Promise<PklPlacement> {
  const [row] = await listPlacements(tx, { id });
  if (!row) throw notFound();
  return toPlacement(row, today);
}

/**
 * The industry supervisor keeps an active pembimbing_industri membership while they have a
 * placement that is not cancelled and has not ended; otherwise it is suspended (PKL-01).
 */
async function syncMentorAccess(tx: Tx, schoolId: string, userId: string, today: string): Promise<boolean> {
  const active = (await currentPlacementCount(tx, userId, today)) > 0;
  await setPortalMembership(tx, { schoolId, userId, role: 'pembimbing_industri', active });
  return active;
}

/** The account of the named supervisor (outside the tenant transaction: Better Auth has its own connection). */
async function mentorAccount(auth: Auth, input: IndustryMentorInput | null | undefined): Promise<string | null | undefined> {
  if (input === undefined) return undefined;
  return input ? sharedPhoneLogin(auth, input) : null;
}

async function checkMentor(tx: Tx, userId: string | null | undefined): Promise<void> {
  if (userId && (await isStudentLogin(tx, userId))) {
    throw new ConflictError('Nomor ini dipakai login siswa. Pakai nomor pembimbing industri sendiri.', { reason: 'phone_student' });
  }
}

async function checkSchoolMentor(tx: Tx, userId: string | undefined): Promise<void> {
  if (userId && (await activeStaff(tx, [userId])).length === 0) {
    throw new ValidationError([{ path: 'schoolMentorId', message: 'Guru pembimbing harus staf aktif sekolah ini.' }]);
  }
}

async function checkOverlap(tx: Tx, enrollmentIds: string[], from: string, to: string, exceptId?: string): Promise<void> {
  const clash = await overlapping(tx, enrollmentIds, from, to, exceptId);
  if (clash.length > 0) throw new ConflictError('Siswa ini sudah punya penempatan PKL pada periode tersebut.', { reason: 'overlap', enrollmentIds: clash });
}

/** Managers see every placement; anyone else the ones they supervise for the school. */
export function listPklPlacements(actor: Actor, today: string, query: { partnerId?: string; scope: 'current' | 'all' }): Promise<PklPlacementList> {
  return withTenant(scope(actor), async (tx) => {
    const filter: PlacementFilter = { ...(query.partnerId ? { partnerId: query.partnerId } : {}), ...(query.scope === 'current' ? { currentOn: today } : {}) };
    if (!canSeeAllPkl.allows(actor)) filter.schoolMentorId = actor.userId;
    return { items: (await listPlacements(tx, filter)).map((r) => toPlacement(r, today)) };
  });
}

export async function createPklPlacements(auth: Auth, actor: Actor, auditCtx: AuditContext, today: string, input: CreatePklPlacementsRequest): Promise<PklPlacementList> {
  authorize(actor, canManagePkl);
  if (input.endsOn < today) throw new ValidationError([{ path: 'endsOn', message: 'Periode PKL sudah lewat.' }]);
  const mentorId = (await mentorAccount(auth, input.industryMentor)) ?? null;
  return withTenant(scope(actor), async (tx) => {
    await lockPlacements(tx, actor.schoolId);
    const partner = await partnerState(tx, input.partnerId);
    if (!partner) throw new NotFoundError('DUDI tidak ditemukan.');
    if (!partner.active) throw new ConflictError('DUDI ini tidak aktif.', { reason: 'partner_inactive' });
    const active = await activeEnrollments(tx, input.enrollmentIds);
    const inactive = input.enrollmentIds.filter((id) => !active.has(id));
    if (inactive.length > 0) throw new ValidationError([{ path: 'enrollmentIds', message: 'Siswa harus aktif tahun ajaran ini.' }]);
    await checkSchoolMentor(tx, input.schoolMentorId);
    await checkMentor(tx, mentorId);
    await checkOverlap(tx, input.enrollmentIds, input.startsOn, input.endsOn);

    const rows = input.enrollmentIds.map((enrollmentId) => ({
      id: uuidv7(),
      schoolId: actor.schoolId,
      enrollmentId,
      partnerId: input.partnerId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      schoolMentorId: input.schoolMentorId,
      industryMentorId: mentorId,
      createdBy: actor.userId,
    }));
    await insertPlacements(tx, rows);
    if (mentorId && (await syncMentorAccess(tx, actor.schoolId, mentorId, today))) await emit(tx, 'pkl.mentor_assigned', { userId: mentorId });
    for (const r of rows) {
      await audit(tx, auditCtx, 'pkl.placement_created', { type: 'pkl_placement', id: r.id }, {
        after: { partnerId: r.partnerId, startsOn: r.startsOn, endsOn: r.endsOn, schoolMentorId: r.schoolMentorId, industryMentorId: mentorId },
      });
    }
    const ids = new Set(rows.map((r) => r.id));
    return { items: (await listPlacements(tx, { partnerId: input.partnerId })).filter((r) => ids.has(r.id)).map((r) => toPlacement(r, today)) };
  });
}

/** Changes the end date or the supervisors; the previous industry supervisor loses access when nothing else is left. */
export async function patchPklPlacement(auth: Auth, actor: Actor, auditCtx: AuditContext, today: string, id: string, input: UpdatePklPlacementRequest): Promise<PklPlacement> {
  authorize(actor, canManagePkl);
  const mentorId = await mentorAccount(auth, input.industryMentor);
  return withTenant(scope(actor), async (tx) => {
    await lockPlacements(tx, actor.schoolId);
    const before = await one(tx, id, today);
    if (before.status === 'cancelled') throw new ConflictError('Penempatan ini sudah dibatalkan.', { reason: 'cancelled' });
    if (input.endsOn !== undefined) {
      if (input.endsOn < before.startsOn) throw new ValidationError([{ path: 'endsOn', message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' }]);
      if (input.endsOn > before.endsOn) await checkOverlap(tx, [before.student.enrollmentId], before.startsOn, input.endsOn, id);
    }
    await checkSchoolMentor(tx, input.schoolMentorId);
    await checkMentor(tx, mentorId);

    await updatePlacement(tx, id, {
      ...(input.endsOn !== undefined ? { endsOn: input.endsOn } : {}),
      ...(input.schoolMentorId !== undefined ? { schoolMentorId: input.schoolMentorId } : {}),
      ...(mentorId !== undefined ? { industryMentorId: mentorId } : {}),
    });
    const previous = before.industryMentor?.id ?? null;
    if (previous) await syncMentorAccess(tx, actor.schoolId, previous, today);
    if (mentorId && mentorId !== previous && (await syncMentorAccess(tx, actor.schoolId, mentorId, today))) await emit(tx, 'pkl.mentor_assigned', { userId: mentorId });

    const after = { ...input, ...(mentorId !== undefined ? { industryMentor: undefined, industryMentorId: mentorId } : {}) };
    await audit(tx, auditCtx, 'pkl.placement_updated', { type: 'pkl_placement', id }, {
      before: { endsOn: before.endsOn, schoolMentorId: before.schoolMentor?.id ?? null, industryMentorId: previous },
      after,
    });
    return one(tx, id, today);
  });
}

/** Cancels a placement (sessions already generated stay); cancelling again changes nothing. */
export function cancelPklPlacement(actor: Actor, auditCtx: AuditContext, today: string, id: string): Promise<PklPlacement> {
  authorize(actor, canManagePkl);
  return withTenant(scope(actor), async (tx) => {
    const before = await one(tx, id, today);
    if (before.status === 'cancelled') return before;
    await updatePlacement(tx, id, { status: 'cancelled', cancelledAt: new Date() });
    if (before.industryMentor) await syncMentorAccess(tx, actor.schoolId, before.industryMentor.id, today);
    await audit(tx, auditCtx, 'pkl.placement_cancelled', { type: 'pkl_placement', id }, { before: { status: 'active' }, after: { status: 'cancelled' } });
    return one(tx, id, today);
  });
}

/**
 * Job pkl.expire-mentors: suspends industry supervisors whose placements all ended (each school's own
 * date). withPlatform only lists the schools that have active supervisors; the work runs in withTenant.
 */
export async function expireIndustryMentors(now = new Date(), logger?: Logger): Promise<number> {
  const schools = await withPlatform(async (tx) => {
    const res = await tx.execute<{ id: string; timezone: string }>(sql`
      select distinct s.id, s.timezone from memberships m join schools s on s.id = m.school_id
       where m.role = 'pembimbing_industri' and m.status = 'active'`);
    return res.rows;
  });
  let suspended = 0;
  for (const school of schools) {
    try {
      const today = schoolDate(school.timezone, now);
      suspended += await withTenant({ schoolId: school.id, userId: null }, async (tx) => {
        let n = 0;
        for (const userId of await activeIndustryMentors(tx)) if (!(await syncMentorAccess(tx, school.id, userId, today))) n += 1;
        return n;
      });
    } catch (err) {
      logger?.error({ err, schoolId: school.id }, 'pkl expire-mentors failed for school');
    }
  }
  return suspended;
}
