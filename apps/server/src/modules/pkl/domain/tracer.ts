import { TRACER_BMW, TRACER_STATUSES, type ClassStream, type TracerCounts, type TracerRecap, type TracerRecapRow, type TracerStatus } from '@absah/contracts';

/** Pure arithmetic of the tracer study recap (PKL-05). */

export interface RecapInput {
  graduationYear: number;
  stream: ClassStream | null;
  /** null: has not answered. */
  status: TracerStatus | null;
}

const emptyCounts = (): TracerCounts => ({ bekerja: 0, melanjutkan: 0, wirausaha: 0, belum: 0 });

/** BMW share of the people who answered, one decimal; null when nobody did. Alumni who did not answer are not counted against the school. */
export function bmwPercent(counts: TracerCounts): number | null {
  const answered = TRACER_STATUSES.reduce((n, s) => n + counts[s], 0);
  if (answered === 0) return null;
  return Math.round((TRACER_BMW.reduce((n, s) => n + counts[s], 0) / answered) * 1000) / 10;
}

const STREAM_ORDER: Record<string, number> = { ipa: 0, ips: 1, bahasa: 2, keagamaan: 3 };

/** Newest angkatan first; within one, by jurusan (those without a jurusan last). */
export function tracerRecap(alumni: readonly RecapInput[]): TracerRecap {
  const groups = new Map<string, { year: number; stream: ClassStream | null; total: number; counts: TracerCounts }>();
  const totals = { total: 0, counts: emptyCounts() };
  for (const a of alumni) {
    const key = `${a.graduationYear}|${a.stream ?? ''}`;
    const g = groups.get(key) ?? { year: a.graduationYear, stream: a.stream, total: 0, counts: emptyCounts() };
    g.total += 1;
    totals.total += 1;
    if (a.status) {
      g.counts[a.status] += 1;
      totals.counts[a.status] += 1;
    }
    groups.set(key, g);
  }
  const rows: TracerRecapRow[] = [...groups.values()]
    .sort((a, b) => b.year - a.year || (a.stream ? (STREAM_ORDER[a.stream] ?? 9) : 99) - (b.stream ? (STREAM_ORDER[b.stream] ?? 9) : 99))
    .map((g) => ({ graduationYear: g.year, stream: g.stream, total: g.total, answered: TRACER_STATUSES.reduce((n, s) => n + g.counts[s], 0), counts: g.counts, bmwPercent: bmwPercent(g.counts) }));
  return { rows, totals: { total: totals.total, answered: TRACER_STATUSES.reduce((n, s) => n + totals.counts[s], 0), counts: totals.counts, bmwPercent: bmwPercent(totals.counts) } };
}
