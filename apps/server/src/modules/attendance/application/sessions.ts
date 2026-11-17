import type { SessionDetail, SessionSummary, SubmitSessionRequest, TodayResponse } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError, SessionLockedError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canSeeAllSessions, mayFillSession, mayViewSession } from '../domain/policies';
import { SOURCE_PRIORITY, teacherCanSet } from '../domain/status-rules';
import { listSessions, lockSessionRow, markSubmitted, recordsOf, roster, type SessionRow } from '../infrastructure/attendance-repo';
import { changeMarks } from './marks';

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
    topic: r.topic,
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
 * all as source teacher, never over izin, UKS or a correction (teacherCanSet). Sending the same
 * list again changes nothing; attendance.absent_marked fires only when a student becomes A.
 */
export async function submitSession(actor: Actor, sessionId: string, input: SubmitSessionRequest): Promise<SessionDetail> {
  return withTenant(scope(actor), async (tx) => {
    const session = await lockSessionRow(tx, sessionId);
    const [row] = session ? await listSessions(tx, { id: sessionId }) : [];
    if (!session || !row || !mayViewSession(actor, row)) throw new NotFoundError('Sesi tidak ditemukan.');
    if (!mayFillSession(actor, row)) throw new ForbiddenError('Sesi ini diisi oleh guru pengampu atau wali kelas.');
    if (session.lockedAt) throw new SessionLockedError();
    if (input.topic && row.mode !== 'per_period') throw new ValidationError([{ path: 'topic', message: 'Topik hanya untuk sesi per jam pelajaran.' }]);

    const students = await roster(tx, row);
    const onRoster = new Set(students.map((st) => st.enrollmentId));
    const exceptions = new Map(input.exceptions.map((e) => [e.enrollmentId, e.status]));
    const issues = [];
    if (exceptions.size !== input.exceptions.length) issues.push({ path: 'exceptions', message: 'Ada siswa yang tercantum dua kali.' });
    if ([...exceptions.keys()].some((id) => !onRoster.has(id))) issues.push({ path: 'exceptions', message: 'Ada siswa yang tidak terdaftar di sesi ini.' });
    if (issues.length) throw new ValidationError(issues);

    // The teacher's word is kept as a mark under higher sources too, but only students the teacher
    // can set (nothing higher marked) are written: fixed rows were never shown as choices.
    const existing = new Map((await recordsOf(tx, sessionId)).map((r) => [r.enrollmentId, r]));
    const write = students.flatMap((st) => {
      const status = exceptions.get(st.enrollmentId) ?? ('H' as const);
      const current = existing.get(st.enrollmentId);
      if (!teacherCanSet(current)) return [];
      if (current?.status === status && current.source === 'teacher') return [];
      return [{ sessionId, enrollmentId: st.enrollmentId, source: 'teacher' as const, status, recordedBy: actor.userId }];
    });
    await changeMarks(tx, actor.schoolId, { write, touch: students.map((st) => ({ sessionId, enrollmentId: st.enrollmentId })) });
    await markSubmitted(tx, sessionId, actor.userId, input.topic === undefined ? undefined : input.topic || null);
    return detail(tx, actor, sessionId);
  });
}
