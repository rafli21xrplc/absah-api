import { SUBSTITUTE_ROLES, type AssignSubstituteRequest, type CandidateList, type SubstituteCandidate, type SubstitutionItem, type SubstitutionList } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { isoWeekday, listSessions, type SessionRow } from '../../attendance';
import { canAssignSubstitute, canSeeSubstitutions } from '../domain/policies';
import { isSubstitutableMode, rankCandidates, unavailableReason } from '../domain/substitutes';
import {
  busyTeachers,
  checkedInOn,
  leavesOn,
  lockSession,
  lockSubstitutionsOn,
  moveSession,
  substitutePool,
  substitutionCounts,
  substitutionRows,
  teachersOfSubject,
  type SubstitutionRow,
} from '../infrastructure/substitution-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

const sessionView = (r: SessionRow): SubstitutionItem['session'] => ({
  id: r.id,
  schoolDate: r.schoolDate,
  mode: r.mode,
  owner: { type: r.ownerType, id: r.ownerId, name: r.ownerName },
  period: r.periodNumber !== null && r.startsAt && r.endsAt ? { number: r.periodNumber, startsAt: r.startsAt.slice(0, 5), endsAt: r.endsAt.slice(0, 5) } : null,
  subject: r.subjectId ? { id: r.subjectId, name: r.subjectName ?? '' } : null,
});

/** The day's lessons and daily sessions that need a substitute or have one (see listSubstitutions). Sequential: one transaction, one connection. */
async function substitutionItems(tx: Tx, date: string): Promise<SubstitutionItem[]> {
  const rows = await listSessions(tx, { date, withoutPkl: true });
  const leaveOf = new Map((await leavesOn(tx, date)).map((l) => [l.userId, l]));
  const substitutable = rows.filter((r) => isSubstitutableMode(r.mode));
  const bySession = new Map<string, SubstitutionRow[]>();
  for (const h of await substitutionRows(tx, substitutable.map((r) => r.id))) bySession.set(h.sessionId, [...(bySession.get(h.sessionId) ?? []), h]);
  const items: SubstitutionItem[] = [];
  for (const r of substitutable) {
    const changes: SubstitutionRow[] = bySession.get(r.id) ?? [];
    const latest = changes.at(-1);
    const original = changes[0]?.fromTeacherId;
    if (latest && original) {
      items.push({ session: sessionView(r), absentTeacher: { id: original, name: changes[0]?.fromTeacherName ?? '' }, leaveKind: leaveOf.get(original)?.kind ?? null, substitute: { id: latest.substituteId, name: latest.substituteName ?? '', assignedAt: latest.createdAt.toISOString() }, status: 'assigned' });
    } else if (!latest && r.teacherId && leaveOf.has(r.teacherId) && r.lockedAt === null) {
      items.push({ session: sessionView(r), absentTeacher: { id: r.teacherId, name: r.teacherName ?? '' }, leaveKind: leaveOf.get(r.teacherId)?.kind ?? null, substitute: null, status: 'needed' });
    }
  }
  return items;
}

/**
 * GET /substitutions?date=: sessions whose teacher is on approved izin (status needed) and those that already have a
 * substitute (assigned). A session without one stays on this list until someone is assigned: it is computed from the
 * izin each time, not remembered.
 */
export function listSubstitutions(actor: Actor, today: string, date: string | undefined): Promise<SubstitutionList> {
  authorize(actor, canSeeSubstitutions);
  const schoolDate = date ?? today;
  return withTenant(scope(actor), async (tx) => ({ schoolDate, items: await substitutionItems(tx, schoolDate) }));
}

/** Everything needed to say who may take a session over: the teacher it belongs to, who is free, who is on izin. */
async function availability(tx: Tx, session: SessionRow, absentTeacherId: string) {
  const date = session.schoolDate;
  const [pool, leaves, busy, checkedIn, counts, sameSubject] = [
    await substitutePool(tx, SUBSTITUTE_ROLES),
    await leavesOn(tx, date),
    await busyTeachers(tx, { date, weekday: isoWeekday(date), period: session.mode === 'per_period' ? session.periodNumber : null }),
    await checkedInOn(tx, date),
    await substitutionCounts(tx, date),
    session.subjectId ? await teachersOfSubject(tx, session.subjectId, date) : new Set<string>(),
  ];
  const poolIds = new Set(pool.map((p) => p.userId));
  const onLeave = new Set(leaves.map((l) => l.userId));
  const reasonOf = (userId: string) => unavailableReason({ userId, absentTeacherId, pool: poolIds, onLeave, busy });
  const candidates: SubstituteCandidate[] = pool
    .filter((p) => reasonOf(p.userId) === null)
    .map((p) => ({ userId: p.userId, name: p.name, checkedIn: checkedIn.has(p.userId), sameSubject: sameSubject.has(p.userId), substitutionsThisMonth: counts.get(p.userId) ?? 0 }));
  return { reasonOf, candidates: rankCandidates(candidates) };
}

/** The teacher the session originally belonged to: the one before the first substitution, else its current one. */
async function absentTeacherOf(tx: Tx, session: { id: string; teacherId: string | null }): Promise<{ id: string | null; changed: boolean }> {
  const [first] = await substitutionRows(tx, [session.id]);
  return first ? { id: first.fromTeacherId, changed: true } : { id: session.teacherId, changed: false };
}

async function isOnLeave(tx: Tx, userId: string, date: string): Promise<boolean> {
  return (await leavesOn(tx, date)).some((l) => l.userId === userId);
}

async function sessionById(tx: Tx, id: string): Promise<SessionRow> {
  const [row] = await listSessions(tx, { id });
  if (!row || !isSubstitutableMode(row.mode)) throw new NotFoundError('Sesi tidak ditemukan.');
  return row;
}

/** GET /substitutions/candidates?sessionId=: teachers free at that time, best first. */
export function substituteCandidates(actor: Actor, sessionId: string): Promise<CandidateList> {
  authorize(actor, canSeeSubstitutions);
  return withTenant(scope(actor), async (tx) => {
    const session = await sessionById(tx, sessionId);
    const absent = await absentTeacherOf(tx, session);
    if (!absent.id || (!absent.changed && !(await isOnLeave(tx, absent.id, session.schoolDate)))) throw new ConflictError('Guru sesi ini tidak sedang izin.', { reason: 'not_needed' });
    return { items: (await availability(tx, session, absent.id)).candidates };
  });
}

/**
 * POST /substitutions: gives a session to a substitute. Only a session whose teacher is on approved izin, or that
 * already has a substitute (to change it), and only while it is open. The substitute must be free at that time; all
 * assignments of one school date are serialized so one person cannot be given two sessions at once.
 */
export function assignSubstitute(actor: Actor, auditCtx: AuditContext, input: AssignSubstituteRequest): Promise<SubstitutionItem> {
  authorize(actor, canAssignSubstitute);
  return withTenant(scope(actor), async (tx) => {
    const first = await sessionById(tx, input.sessionId);
    await lockSubstitutionsOn(tx, actor.schoolId, first.schoolDate);
    const locked = await lockSession(tx, input.sessionId);
    if (!locked) throw new NotFoundError('Sesi tidak ditemukan.');
    if (locked.status !== 'open' || locked.lockedAt !== null) throw new ConflictError('Sesi ini sudah selesai, tidak bisa diganti.', { reason: 'session_closed' });

    const session = await sessionById(tx, input.sessionId);
    const absent = await absentTeacherOf(tx, locked);
    if (!absent.id || (!absent.changed && !(await isOnLeave(tx, absent.id, session.schoolDate)))) throw new ConflictError('Guru sesi ini tidak sedang izin.', { reason: 'not_needed' });
    if (locked.teacherId === input.substituteId && input.substituteId !== absent.id) throw new ConflictError('Guru ini sudah menjadi pengganti sesi ini.', { reason: 'already_assigned' });

    const { reasonOf } = await availability(tx, session, absent.id);
    const reason = reasonOf(input.substituteId);
    if (reason) {
      const message = { not_a_teacher: 'Orang ini bukan guru yang bisa menggantikan.', is_absent_teacher: 'Pengganti tidak boleh guru yang izin.', on_leave: 'Guru ini sedang izin.', busy: 'Guru ini punya jam lain pada waktu yang sama.' }[reason];
      throw new ConflictError(message, { reason });
    }

    await moveSession(tx, { id: locked.id, schoolId: actor.schoolId, fromTeacherId: locked.teacherId, substituteId: input.substituteId, assignedBy: actor.userId, rowId: uuidv7() });
    await emit(tx, 'teacher.substitute_assigned', { sessionId: locked.id, substituteId: input.substituteId });
    await audit(tx, auditCtx, 'teacher.substitute_assigned', { type: 'attendance_session', id: locked.id }, { before: { teacherId: locked.teacherId }, after: { teacherId: input.substituteId, schoolDate: session.schoolDate } });

    const row = (await substitutionItems(tx, session.schoolDate)).find((i) => i.session.id === locked.id);
    if (!row) throw new NotFoundError('Sesi tidak ditemukan.');
    return row;
  });
}
