/**
 * Workspace billing (BIL): pure rules, docs/prompts.md prompt 4.3.
 * - Rp10.000 per active student per month, every feature included.
 * - Pro rata per calendar day: active 10 of 31 days = 10/31 x Rp10.000.
 * - Days marked billing_exempt (long year-end break, set by the Absah team) are not billed.
 * - Rounded to the nearest rupiah on the invoice total, never per student.
 */

export const PRICE_PER_STUDENT_MONTH = 10_000;

/** One enrollment of a student: inclusive school dates; to null = still enrolled. */
export interface EnrollmentPeriod {
  studentId: string;
  from: string;
  to: string | null;
}

export interface InvoiceLine {
  studentId: string;
  /** Billed days: active, inside the month, not exempt. */
  days: number;
  /** Exact share before rounding (display only; the total is rounded once). */
  amount: number;
}

export interface ComputedInvoice {
  month: string;
  daysInMonth: number;
  unitPrice: number;
  exemptDays: number;
  lines: InvoiceLine[];
  billedDays: number;
  total: number;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2028-02" -> 29. */
export function daysInMonth(month: string): number {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`invalid month: ${month}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** First and last date of the month ("2027-01" -> ["2027-01-01", "2027-01-31"]). */
export function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`];
}

/** The month before "2027-01" is "2026-12". */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 0, (m ?? 1) - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** Day of month (1-based) of a YYYY-MM-DD inside `month`, clamped to the month. */
function dayIndex(date: string, month: string, last: number, edge: 'from' | 'to'): number {
  if (date.slice(0, 7) < month) return edge === 'from' ? 1 : 0;
  if (date.slice(0, 7) > month) return edge === 'from' ? last + 1 : last;
  return Number(date.slice(8, 10));
}

/**
 * The invoice of one school for one month. A student counts once per day however many enrollments
 * cover it (class change, overlapping rows); exempt days outside a student's enrollment change nothing.
 */
export function computeInvoice(enrollments: readonly EnrollmentPeriod[], exemptDays: readonly string[], month: string): ComputedInvoice {
  const last = daysInMonth(month);
  const exempt = new Set(exemptDays.filter((d) => d.slice(0, 7) === month).map((d) => Number(d.slice(8, 10))));
  const daysOf = new Map<string, Set<number>>();
  for (const e of enrollments) {
    const from = dayIndex(e.from, month, last, 'from');
    const to = e.to === null ? last : dayIndex(e.to, month, last, 'to');
    if (from > to) continue;
    const days = daysOf.get(e.studentId) ?? new Set<number>();
    for (let d = from; d <= to; d += 1) if (!exempt.has(d)) days.add(d);
    daysOf.set(e.studentId, days);
  }
  const lines = [...daysOf.entries()]
    .filter(([, days]) => days.size > 0)
    .map(([studentId, days]) => ({ studentId, days: days.size, amount: (PRICE_PER_STUDENT_MONTH * days.size) / last }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
  const billedDays = lines.reduce((n, l) => n + l.days, 0);
  return {
    month,
    daysInMonth: last,
    unitPrice: PRICE_PER_STUDENT_MONTH,
    exemptDays: exempt.size,
    lines,
    billedDays,
    // Integer numerator, one division, one rounding: exact for any realistic school size.
    total: Math.round((PRICE_PER_STUDENT_MONTH * billedDays) / last),
  };
}
