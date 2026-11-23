import type { JournalEntry, JournalQuery, JournalResponse } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canReadAllJournals } from '../domain/policies';
import { listSessions, memberName } from '../infrastructure/attendance-repo';
import { journalWorkbook } from '../infrastructure/journal-xlsx';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/** First and last school date of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** A guru reads only their own journal; admin, kepsek and wakasek may pick a teacher or read all. */
function teacherScope(actor: Actor, teacherId: string | undefined): string | undefined {
  if (canReadAllJournals.allows(actor)) return teacherId;
  if (teacherId && teacherId !== actor.userId) throw new ForbiddenError('Jurnal guru lain hanya untuk kepala sekolah, wakasek, dan admin.');
  return actor.userId;
}

async function entriesOf(actor: Actor, query: JournalQuery, teacherId: string | undefined): Promise<JournalEntry[]> {
  const rows = await withTenant(scope(actor), (tx) => listSessions(tx, { journal: { ...monthRange(query.month), ...(teacherId ? { teacherId } : {}) } }));
  return rows
    .map((r) => ({
      sessionId: r.id,
      schoolDate: r.schoolDate,
      period: r.periodNumber !== null && r.startsAt ? { number: r.periodNumber, startsAt: hhmm(r.startsAt), endsAt: hhmm(r.endsAt) } : null,
      className: r.ownerName,
      subject: r.subjectId && r.subjectName ? { id: r.subjectId, name: r.subjectName } : null,
      teacher: r.teacherId ? { id: r.teacherId, name: r.teacherName ?? '' } : null,
      status: r.status,
      topic: r.topic,
    }))
    .sort((a, b) => a.schoolDate.localeCompare(b.schoolDate) || (a.period?.number ?? 0) - (b.period?.number ?? 0) || a.className.localeCompare(b.className));
}

export async function getJournal(actor: Actor, query: JournalQuery): Promise<JournalResponse> {
  const entries = await entriesOf(actor, query, teacherScope(actor, query.teacherId));
  return { month: query.month, entries, totals: { sessions: entries.length, withTopic: entries.filter((e) => e.topic).length } };
}

/** Excel of one teacher-month. Managers must say which teacher; a guru gets their own. */
export async function exportJournal(actor: Actor, query: JournalQuery): Promise<{ file: Buffer; fileName: string }> {
  const teacherId = teacherScope(actor, query.teacherId);
  if (!teacherId) throw new ValidationError([{ path: 'teacherId', message: 'Pilih guru yang jurnalnya diekspor.' }]);
  const teacherName = await withTenant(scope(actor), (tx) => memberName(tx, teacherId));
  if (!teacherName) throw new NotFoundError('Guru tidak ditemukan.');
  const entries = await entriesOf(actor, query, teacherId);
  const slug = teacherName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guru';
  return { file: await journalWorkbook({ teacherName, month: query.month, entries }), fileName: `jurnal-mengajar-${slug}-${query.month}.xlsx` };
}
