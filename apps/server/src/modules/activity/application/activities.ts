import type { Activity, ActivityList, ActivityMemberList, CreateActivityRequest, SetActivityMembersRequest, UpdateActivityRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManageActivities, canSeeAllActivities } from '../domain/policies';
import {
  activeEnrollmentIds,
  activeStaff,
  activeYear,
  coachesOf,
  insertActivity,
  isCoach,
  listActivities,
  membersOf,
  replaceCoaches,
  replaceMembers,
  searchStudents,
  updateActivity,
  type ActivityRow,
} from '../infrastructure/activity-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NAME_TAKEN = 'Nama kegiatan sudah dipakai tahun ajaran ini.';

async function requireYear(tx: Tx): Promise<string> {
  const year = await activeYear(tx);
  if (!year) throw new ConflictError('Belum ada tahun ajaran aktif.');
  return year.id;
}

async function withCoaches(tx: Tx, rows: ActivityRow[]): Promise<Activity[]> {
  const coaches = await coachesOf(tx, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, coaches: coaches.filter((c) => c.activityId === r.id).map((c) => ({ id: c.id, name: c.name })) }));
}

async function one(tx: Tx, yearId: string, id: string): Promise<Activity> {
  const [row] = await withCoaches(tx, await listActivities(tx, yearId, { id }));
  if (!row) throw new NotFoundError('Kegiatan tidak ditemukan.');
  return row;
}

async function checkCoaches(tx: Tx, ids: string[]): Promise<void> {
  const staff = await activeStaff(tx, ids);
  if (ids.some((id) => !staff.has(id))) throw new ValidationError([{ path: 'coachIds', message: 'Pembina harus staf aktif sekolah ini.' }]);
}

/** Managers see every activity of the active year; anyone else the ones they coach. */
export function listForActor(actor: Actor): Promise<ActivityList> {
  return withTenant(scope(actor), async (tx) => {
    const year = await activeYear(tx);
    if (!year) return { items: [] };
    const rows = await listActivities(tx, year.id, canSeeAllActivities.allows(actor) ? {} : { coachId: actor.userId });
    return { items: await withCoaches(tx, rows) };
  });
}

/** Managers, or a coach of this activity. 404 (not 403) for others, as for unknown ids. */
async function visible(tx: Tx, actor: Actor, activityId: string): Promise<{ yearId: string; activity: Activity; coach: boolean }> {
  const yearId = await requireYear(tx);
  const activity = await one(tx, yearId, activityId);
  const coach = await isCoach(tx, activityId, actor.userId);
  if (!coach && !canSeeAllActivities.allows(actor)) throw new NotFoundError('Kegiatan tidak ditemukan.');
  return { yearId, activity, coach };
}

export function getActivity(actor: Actor, activityId: string): Promise<Activity> {
  return withTenant(scope(actor), async (tx) => (await visible(tx, actor, activityId)).activity);
}

export function createActivity(actor: Actor, auditCtx: AuditContext, input: CreateActivityRequest): Promise<Activity> {
  if (!canManageActivities.allows(actor)) throw new ForbiddenError('Kegiatan dibuat oleh admin atau wakasek.');
  return withTenant(scope(actor), async (tx) => {
    const yearId = await requireYear(tx);
    await checkCoaches(tx, input.coachIds);
    const id = uuidv7();
    try {
      await insertActivity(tx, {
        id,
        schoolId: actor.schoolId,
        academicYearId: yearId,
        name: input.name,
        kind: input.kind,
        location: input.location,
        days: [...input.days].sort(),
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        createdBy: actor.userId,
      });
    } catch (err) {
      if (isUniqueViolation(err, 'activities_school_id_year_name_key')) throw new ConflictError(NAME_TAKEN);
      throw err;
    }
    await replaceCoaches(tx, actor.schoolId, id, input.coachIds);
    await audit(tx, auditCtx, 'activity.created', { type: 'activity', id }, { after: { name: input.name, kind: input.kind, coachIds: input.coachIds } });
    return one(tx, yearId, id);
  });
}

export function patchActivity(actor: Actor, auditCtx: AuditContext, activityId: string, input: UpdateActivityRequest): Promise<Activity> {
  if (!canManageActivities.allows(actor)) throw new ForbiddenError('Kegiatan diubah oleh admin atau wakasek.');
  return withTenant(scope(actor), async (tx) => {
    const yearId = await requireYear(tx);
    const before = await one(tx, yearId, activityId);
    const { coachIds, days, ...rest } = input;
    const startsOn = rest.startsOn === undefined ? before.startsOn : rest.startsOn;
    const endsOn = rest.endsOn === undefined ? before.endsOn : rest.endsOn;
    if (startsOn && endsOn && startsOn > endsOn) throw new ValidationError([{ path: 'endsOn', message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' }]);
    try {
      await updateActivity(tx, activityId, { ...rest, ...(days ? { days: [...days].sort() } : {}) });
    } catch (err) {
      if (isUniqueViolation(err, 'activities_school_id_year_name_key')) throw new ConflictError(NAME_TAKEN);
      throw err;
    }
    if (coachIds) {
      await checkCoaches(tx, coachIds);
      await replaceCoaches(tx, actor.schoolId, activityId, coachIds);
    }
    await audit(tx, auditCtx, 'activity.updated', { type: 'activity', id: activityId }, { before: { name: before.name, active: before.active }, after: input });
    return one(tx, yearId, activityId);
  });
}

export function getMembers(actor: Actor, activityId: string): Promise<ActivityMemberList> {
  return withTenant(scope(actor), async (tx) => {
    await visible(tx, actor, activityId);
    return { items: await membersOf(tx, activityId) };
  });
}

/** Managers or the activity's coaches replace the member list; members must be active this year. */
export function setMembers(actor: Actor, auditCtx: AuditContext, activityId: string, input: SetActivityMembersRequest): Promise<ActivityMemberList> {
  return withTenant(scope(actor), async (tx) => {
    const { yearId, coach } = await visible(tx, actor, activityId);
    if (!coach && !canManageActivities.allows(actor)) throw new ForbiddenError('Peserta diatur oleh pembina kegiatan.');
    const ids = [...new Set(input.enrollmentIds)];
    const active = await activeEnrollmentIds(tx, yearId, ids);
    if (active.size !== ids.length) throw new ValidationError([{ path: 'enrollmentIds', message: 'Ada siswa yang tidak aktif di tahun ajaran ini.' }]);
    await replaceMembers(tx, actor.schoolId, activityId, ids);
    await audit(tx, auditCtx, 'activity.members_set', { type: 'activity', id: activityId }, { after: { count: ids.length } });
    return { items: await membersOf(tx, activityId) };
  });
}

/** Student search to add members: managers and anyone who coaches at least one activity. */
export function findStudents(actor: Actor, text: string): Promise<ActivityMemberList> {
  return withTenant(scope(actor), async (tx) => {
    const yearId = await requireYear(tx);
    if (!canSeeAllActivities.allows(actor) && (await listActivities(tx, yearId, { coachId: actor.userId })).length === 0) {
      throw new ForbiddenError('Pencarian siswa untuk pembina kegiatan.');
    }
    return { items: await searchStudents(tx, yearId, text) };
  });
}
