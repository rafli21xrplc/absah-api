import type { SyncSessionRequest, SyncSessionResult } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { mayFillSession, mayViewSession } from '../domain/policies';
import { teacherCanSet } from '../domain/status-rules';
import { listSessions, lockSessionRow, recordsOf, roster } from '../infrastructure/attendance-repo';
import { insertCorrections, listCorrections } from '../infrastructure/correction-repo';
import { toCorrection } from './corrections';
import { exceptionMap, submitInTx } from './sessions';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

/** "22 Nov 2026 07.41" on the school's clock, for the reason a reviewer reads. */
function capturedLabel(capturedAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('id-ID', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(capturedAt));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')} ${part('hour')}.${part('minute')}`;
}

/**
 * PRS-08: a session taken offline reaches the server later. If it is still open it is submitted as usual (same rules, same
 * result as POST /sessions/{id}/submit). If it was locked meanwhile the teacher's answers are not thrown away and not
 * refused: each student whose answer differs from what is recorded becomes a correction request ("diisi offline ..."),
 * skipping students the teacher could not set anyway (izin, UKS, an earlier correction) and those already pending.
 * Retrying with the same Idempotency-Key replays; without it, the pending-correction rule keeps it from doubling.
 */
export async function syncSession(actor: Actor, timezone: string, sessionId: string, input: SyncSessionRequest): Promise<SyncSessionResult> {
  return withTenant(scope(actor), async (tx) => {
    const session = await lockSessionRow(tx, sessionId);
    if (session && !session.lockedAt) {
      const submit = { exceptions: input.exceptions, ...(input.topic === undefined ? {} : { topic: input.topic }) };
      return { outcome: 'submitted', session: await submitInTx(tx, actor, sessionId, submit), corrections: [], skipped: 0 };
    }
    const [row] = session ? await listSessions(tx, { id: sessionId }) : [];
    if (!session || !row || !mayViewSession(actor, row)) throw new NotFoundError('Sesi tidak ditemukan.');
    if (!mayFillSession(actor, row)) throw new ForbiddenError('Sesi ini diisi oleh guru pengampu atau wali kelas.');

    const students = await roster(tx, row);
    const exceptions = exceptionMap(students, input);
    const records = new Map((await recordsOf(tx, sessionId)).map((r) => [r.enrollmentId, r]));
    const pending = new Set((await listCorrections(tx, { status: 'pending' })).filter((c) => c.sessionId === sessionId).map((c) => c.enrollmentId));

    const changes = students.flatMap((st) => {
      const wanted = exceptions.get(st.enrollmentId) ?? ('H' as const);
      const current = records.get(st.enrollmentId);
      if (current?.status === wanted || !teacherCanSet(current) || pending.has(st.enrollmentId)) return [];
      return [{ enrollmentId: st.enrollmentId, from: current?.status ?? null, to: wanted }];
    });
    const skipped = students.length - changes.length;
    if (changes.length === 0) return { outcome: 'unchanged', session: null, corrections: [], skipped };

    const reason = `Diisi saat offline (${capturedLabel(input.capturedAt, timezone)}); sesi sudah terkunci saat disinkronkan.`;
    const ids = await insertCorrections(
      tx,
      changes.map((ch) => ({ schoolId: actor.schoolId, sessionId, enrollmentId: ch.enrollmentId, fromStatus: ch.from, toStatus: ch.to, reason, requestedBy: actor.userId })),
    );
    return { outcome: 'correction_requested', session: null, corrections: (await listCorrections(tx, { ids })).map(toCorrection), skipped };
  });
}
