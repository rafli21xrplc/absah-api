import type { SessionDetail, SessionSummary, SubmitSessionRequest, TodayResponse } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError, SessionLockedError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { canSeeAllSessions, mayFillSession, mayViewSession } from '../domain/policies';
import { SOURCE_PRIORITY, shouldReplace } from '../domain/status-rules';
import { listSessions, lockSessionRow, markSubmitted, recordsOf, roster, upsertRecords, type SessionRow } from '../infrastructure/attendance-repo';
import { recomputeDaily } from '../infrastructure/session-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

function toSummary(actor: Actor, r: SessionRow): SessionSummary {
  return {
    id: r.id,
    schoolDate: r.schoolDate,
    mode: r.mode,
    status: r.status,
    owner: { type: r.ownerType, id: r.ownerId, name: r.ownerName },
    period: r.periodNumber !== null && r.startsAt ? { number: r.periodNumber, startsAt: hhmm(r.startsAt), endsAt: hhmm(r.endsAt) } : null,
    subject: r.subjectId && r.subjectName ? { id: r.subjectId, name: r.subjectName } : null,
    teacher: r.teacherId ? { id: r.teacherId, name: r.teacherName ?? '' } : null,
    counts: { students: r.students, filled: r.filled, absent: r.absent },
    canFill: r.lockedAt === null && mayFillSession(actor, r),
  };
}

/** Hari ini: the sessions of the user (scope mine) or of the whole school (scope all). */
export async function getToday(actor: Actor, schoolDate: string, scopeAll: boolean): Promise<TodayResponse> {
  if (scopeAll && !canSeeAllSessions.allows(actor)) throw new ForbiddenError();
  const rows = await withTenant(scope(actor), (tx) => listSessions(tx, { date: schoolDate, ...(scopeAll ? {} : { forUser: actor.userId }) }));
  return { schoolDate, sessions: rows.map((r) => toSummary(actor, r)) };
}

/** Teacher writes cannot replace these: shown as fixed in the session screen. */
const isFixed = (source: string | null) => source !== null && SOURCE_PRIORITY[source as keyof typeof SOURCE_PRIORITY] > SOURCE_PRIORITY.teacher;

async function detail(tx: Tx, actor: Actor, sessionId: string): Promise<SessionDetail> {
  const [row] = await listSessions(tx, { id: sessionId });
  if (!row || !mayViewSession(actor, row)) throw new NotFoundError('Sesi tidak ditemukan.');
  const records = new Map((await recordsOf(tx, sessionId)).map((r) => [r.enrollmentId, r]));
  const students = (await roster(tx, row)).map((st) => {
    const rec = records.get(st.enrollmentId);
    return { ...st, status: rec?.status ?? null, source: rec?.source ?? null, fixed: isFixed(rec?.source ?? null) };
  });
  return { ...toSummary(actor, row), students };
}

export function getSession(actor: Actor, sessionId: string): Promise<SessionDetail> {
  return withTenant(scope(actor), (tx) => detail(tx, actor, sessionId));
}

/**
 * "Semua hadir kecuali...": the listed students get their status, everyone else on the roster H,
 * all as source teacher, never over izin, UKS or a correction (shouldReplace). Sending the same
 * list again changes nothing; attendance.absent_marked fires only when a student becomes A.
 */
export async function submitSession(actor: Actor, sessionId: string, input: SubmitSessionRequest): Promise<SessionDetail> {
  return withTenant(scope(actor), async (tx) => {
    const session = await lockSessionRow(tx, sessionId);
    const [row] = session ? await listSessions(tx, { id: sessionId }) : [];
    if (!session || !row || !mayViewSession(actor, row)) throw new NotFoundError('Sesi tidak ditemukan.');
    if (!mayFillSession(actor, row)) throw new ForbiddenError('Sesi ini diisi oleh guru pengampu atau wali kelas.');
    if (session.lockedAt) throw new SessionLockedError();

    const students = await roster(tx, row);
    const onRoster = new Set(students.map((st) => st.enrollmentId));
    const exceptions = new Map(input.exceptions.map((e) => [e.enrollmentId, e.status]));
    const issues = [];
    if (exceptions.size !== input.exceptions.length) issues.push({ path: 'exceptions', message: 'Ada siswa yang tercantum dua kali.' });
    if ([...exceptions.keys()].some((id) => !onRoster.has(id))) issues.push({ path: 'exceptions', message: 'Ada siswa yang tidak terdaftar di sesi ini.' });
    if (issues.length) throw new ValidationError(issues);

    const existing = new Map((await recordsOf(tx, sessionId)).map((r) => [r.enrollmentId, r]));
    const writes = students.flatMap((st) => {
      const incoming = { status: exceptions.get(st.enrollmentId) ?? ('H' as const), source: 'teacher' as const };
      const current = existing.get(st.enrollmentId);
      if (!shouldReplace(current, incoming)) return [];
      if (current?.status === incoming.status && current.source === incoming.source) return [];
      return [{ schoolId: actor.schoolId, sessionId, enrollmentId: st.enrollmentId, ...incoming, sourceRef: null, recordedBy: actor.userId }];
    });
    await upsertRecords(tx, writes);
    await markSubmitted(tx, sessionId, actor.userId);
    await recomputeDaily(tx, actor.schoolId, session.schoolDate, students.map((st) => st.enrollmentId));
    for (const w of writes) {
      if (w.status === 'A') await emit(tx, 'attendance.absent_marked', { sessionId, enrollmentId: w.enrollmentId });
    }
    return detail(tx, actor, sessionId);
  });
}
