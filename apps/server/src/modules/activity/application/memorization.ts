import { SURAH_NAMES, type CreateMemorizationLogRequest, type MemorizationLog, type MemorizationLogList, type MemorizationStudentList } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canRecordMemorization, canSeeAllActivities } from '../domain/policies';
import { studentForHabits } from '../infrastructure/habit-repo';
import { insertLog, logsOf, searchActiveStudents } from '../infrastructure/memorization-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const LIST_LIMIT = 200;

type Row = Awaited<ReturnType<typeof logsOf>>[number];
const view = (studentId: string, r: Row): MemorizationLog => ({
  id: r.id,
  studentId,
  date: r.school_date,
  surah: r.surah,
  surahName: SURAH_NAMES[r.surah - 1] ?? `Surah ${r.surah}`,
  juz: r.juz,
  ayatFrom: r.ayat_from,
  ayatTo: r.ayat_to,
  score: r.score,
  note: r.note,
  listener: r.listener_id ? { id: r.listener_id, name: r.listener_name ?? 'Mantan staf' } : null,
  createdAt: new Date(r.created_at).toISOString(),
});

/**
 * GET /memorization-logs?studentId (KEG-03): the student, their parents, their wali kelas, the leaders
 * and the writers (guru tahfidz, admin) read it; anyone else 404.
 */
export function memorizationLogs(actor: Actor, studentId: string): Promise<MemorizationLogList> {
  return withTenant(scope(actor), async (tx) => {
    const s = await studentForHabits(tx, studentId, actor.userId);
    const writer = canRecordMemorization.allows(actor);
    if (!s || !(s.self || s.guardian || s.homeroom || writer || canSeeAllActivities.allows(actor))) throw new NotFoundError('Siswa tidak ditemukan.');
    const rows = await logsOf(tx, studentId, LIST_LIMIT);
    return { studentId, name: s.name, canWrite: writer && s.enrollmentId !== null, items: rows.map((r) => view(studentId, r)) };
  });
}

/** POST /memorization-logs: one setoran, listened to by the actor; today by default, never in the future. */
export function recordMemorization(actor: Actor, auditCtx: AuditContext, today: string, input: CreateMemorizationLogRequest): Promise<MemorizationLog> {
  if (!canRecordMemorization.allows(actor)) throw new ForbiddenError('Setoran hafalan dicatat oleh guru tahfidz.');
  const date = input.date ?? today;
  if (date > today) throw new ValidationError([{ path: 'date', message: 'Tanggal belum tiba.' }]);
  return withTenant(scope(actor), async (tx) => {
    const s = await studentForHabits(tx, input.studentId, actor.userId);
    if (!s) throw new NotFoundError('Siswa tidak ditemukan.');
    if (!s.enrollmentId) throw new ConflictError('Siswa tidak aktif tahun ajaran ini.', { reason: 'not_active' });
    const id = uuidv7();
    await insertLog(tx, {
      id,
      schoolId: actor.schoolId,
      studentId: input.studentId,
      schoolDate: date,
      surah: input.surah,
      juz: input.juz ?? null,
      ayatFrom: input.ayatFrom,
      ayatTo: input.ayatTo,
      score: input.score ?? null,
      note: input.note || null,
      listenerId: actor.userId,
    });
    await audit(tx, auditCtx, 'memorization.recorded', { type: 'memorization_log', id }, { after: { studentId: input.studentId, date, surah: input.surah, ayatFrom: input.ayatFrom, ayatTo: input.ayatTo } });
    const row = (await logsOf(tx, input.studentId, LIST_LIMIT)).find((r) => r.id === id);
    if (!row) throw new Error('memorization log vanished');
    return view(input.studentId, row);
  });
}

/** GET /memorization-logs/students?q= (writers only). */
export function memorizationStudents(actor: Actor, q: string): Promise<MemorizationStudentList> {
  if (!canRecordMemorization.allows(actor)) throw new ForbiddenError('Pencarian siswa untuk guru tahfidz.');
  return withTenant(scope(actor), async (tx) => ({ items: await searchActiveStudents(tx, q) }));
}
