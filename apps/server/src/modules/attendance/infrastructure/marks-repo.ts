import type { AttendanceSource, AttendanceStatus } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { resolveMarks } from '../domain/status-rules';

const m = schema.attendanceMarks;
const r = schema.attendanceRecords;

export interface MarkWrite {
  sessionId: string;
  enrollmentId: string;
  source: AttendanceSource;
  status: AttendanceStatus;
  sourceRef?: string | null;
  recordedBy: string | null;
}

export interface RecordChange {
  sessionId: string;
  enrollmentId: string;
  before: AttendanceStatus | null;
  after: AttendanceStatus | null;
}

type Pair = { sessionId: string; enrollmentId: string };
const pairKey = (p: Pair) => `${p.sessionId}:${p.enrollmentId}`;

export async function writeMarks(tx: Tx, schoolId: string, writes: MarkWrite[]): Promise<void> {
  if (writes.length === 0) return;
  await tx
    .insert(m)
    .values(writes.map((w) => ({ schoolId, ...w, sourceRef: w.sourceRef ?? null })))
    .onConflictDoUpdate({
      target: [m.sessionId, m.enrollmentId, m.source],
      set: { status: sql`excluded.status`, sourceRef: sql`excluded.source_ref`, recordedBy: sql`excluded.recorded_by`, recordedAt: sql`now()` },
    });
}

/** Removes the marks a source wrote for one reference (e.g. all marks of a cancelled izin). */
export async function removeMarksByRef(tx: Tx, source: AttendanceSource, sourceRef: string): Promise<Pair[]> {
  return tx
    .delete(m)
    .where(and(eq(m.source, source), eq(m.sourceRef, sourceRef)))
    .returning({ sessionId: m.sessionId, enrollmentId: m.enrollmentId });
}

/**
 * Re-resolves attendance_records for the given students in sessions from their marks: writes the
 * winner, deletes the record when no mark is left. Returns the status changes.
 */
export async function resolveRecords(tx: Tx, schoolId: string, pairs: Pair[]): Promise<RecordChange[]> {
  const unique = [...new Map(pairs.map((p) => [pairKey(p), p])).values()];
  if (unique.length === 0) return [];
  const sessionIds = [...new Set(unique.map((p) => p.sessionId))];
  const wanted = new Set(unique.map(pairKey));
  const marks = (await tx.select().from(m).where(inArray(m.sessionId, sessionIds))).filter((x) => wanted.has(pairKey(x)));
  const records = (await tx.select().from(r).where(inArray(r.sessionId, sessionIds))).filter((x) => wanted.has(pairKey(x)));
  const marksByPair = new Map<string, typeof marks>();
  for (const mark of marks) marksByPair.set(pairKey(mark), [...(marksByPair.get(pairKey(mark)) ?? []), mark]);
  const recordByPair = new Map(records.map((x) => [pairKey(x), x]));

  const changes: RecordChange[] = [];
  const upserts: (typeof r.$inferInsert)[] = [];
  const deletes: string[] = [];
  for (const p of unique) {
    const winner = resolveMarks(marksByPair.get(pairKey(p)) ?? []);
    const current = recordByPair.get(pairKey(p));
    if (!winner) {
      if (current) deletes.push(current.id);
    } else if (!current || current.status !== winner.status || current.source !== winner.source || current.sourceRef !== winner.sourceRef) {
      upserts.push({ schoolId, sessionId: p.sessionId, enrollmentId: p.enrollmentId, status: winner.status, source: winner.source, sourceRef: winner.sourceRef, recordedBy: winner.recordedBy });
    }
    if ((current?.status ?? null) !== (winner?.status ?? null)) {
      changes.push({ ...p, before: current?.status ?? null, after: winner?.status ?? null });
    }
  }
  if (deletes.length) await tx.delete(r).where(inArray(r.id, deletes));
  if (upserts.length) {
    await tx
      .insert(r)
      .values(upserts)
      .onConflictDoUpdate({
        target: [r.sessionId, r.enrollmentId],
        set: { status: sql`excluded.status`, source: sql`excluded.source`, sourceRef: sql`excluded.source_ref`, recordedBy: sql`excluded.recorded_by`, recordedAt: sql`now()` },
      });
  }
  return changes;
}

export async function sessionDates(tx: Tx, sessionIds: string[]): Promise<Map<string, { schoolDate: string; mode: string }>> {
  if (sessionIds.length === 0) return new Map();
  const s = schema.attendanceSessions;
  const rows = await tx.select({ id: s.id, schoolDate: s.schoolDate, mode: s.mode }).from(s).where(inArray(s.id, sessionIds));
  return new Map(rows.map((x) => [x.id, { schoolDate: x.schoolDate, mode: x.mode }]));
}
