import type { AttendanceStatus, EarlyWarningKind } from '@absah/contracts';

/** What the job needs to know about one student; dates are school dates (YYYY-MM-DD). */
export interface StudentWindow {
  /** The student's rekap harian, one row per recorded school day. Order does not matter. */
  daily: { date: string; status: AttendanceStatus }[];
  /** Days the student was present (H or T) yet marked A in at least one jam pelajaran: bolos jam. */
  bolosDates: string[];
  /** PKL work days the guru pembimbing decided A. */
  pklAbsentDates: string[];
}

export interface PatternRules {
  /** Alpa on this many school days in a row, the last of them recent. */
  consecutiveAlpaDays: number;
  /** Late (T) this many times within the last `recentDays` school days. */
  lateCount: number;
  /** Bolos jam on this many days within the last `recentDays` school days. */
  bolosDays: number;
  /** PKL absences (A) this many times within the last `recentDays` school days. */
  pklAbsences: number;
  /** The look-back, in recorded school days. */
  recentDays: number;
  /** A streak whose last day is older than this many calendar days before `today` is history, not a warning. */
  streakFreshDays: number;
  /** Which patterns the school's capabilities ask for; the other two always apply. */
  focus: { bolosJam: boolean; pkl: boolean };
}

export const DEFAULT_RULES: Omit<PatternRules, 'focus'> = { consecutiveAlpaDays: 3, lateCount: 3, bolosDays: 2, pklAbsences: 2, recentDays: 7, streakFreshDays: 4 };

export interface Pattern {
  kind: EarlyWarningKind;
  /** The school dates that make the pattern, oldest first. */
  dates: string[];
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * The patterns in one student's recent attendance, in the order consecutive_alpa, repeated_late,
 * bolos_jam, pkl_absence (a kind appears at most once). Pure: the job feeds it rows and decides what to
 * do with the answer. bolos_jam and pkl_absence are looked for only when `focus` says the school has jam
 * pelajaran or PKL; nothing here knows a school level.
 */
export function detectPatterns(window: StudentWindow, today: string, rules: PatternRules): Pattern[] {
  const days = [...window.daily].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return [];
  const recent = days.slice(-rules.recentDays);
  const recentFrom = recent[0]?.date ?? today;
  const within = (dates: string[]) => [...new Set(dates)].filter((d) => d >= recentFrom && d <= today).sort();
  const found: Pattern[] = [];

  // Consecutive recorded school days of A ending at the latest one, which must be recent.
  const streak: string[] = [];
  for (let i = days.length - 1; i >= 0 && days[i]?.status === 'A'; i--) streak.unshift(days[i]?.date ?? '');
  const last = days[days.length - 1]?.date ?? '';
  if (streak.length >= rules.consecutiveAlpaDays && daysBetween(last, today) <= rules.streakFreshDays) found.push({ kind: 'consecutive_alpa', dates: streak });

  const late = recent.filter((d) => d.status === 'T').map((d) => d.date);
  if (late.length >= rules.lateCount) found.push({ kind: 'repeated_late', dates: late });

  if (rules.focus.bolosJam) {
    const bolos = within(window.bolosDates);
    if (bolos.length >= rules.bolosDays) found.push({ kind: 'bolos_jam', dates: bolos });
  }
  if (rules.focus.pkl) {
    const absent = within(window.pklAbsentDates);
    if (absent.length >= rules.pklAbsences) found.push({ kind: 'pkl_absence', dates: absent });
  }
  return found;
}

/** Kinds already warned about for this student within the cooldown: the job does not repeat them every evening. */
export function withoutRecent(patterns: Pattern[], recentKinds: ReadonlySet<EarlyWarningKind>): Pattern[] {
  return patterns.filter((p) => !recentKinds.has(p.kind));
}

/** The job runs from 18.00 on the school's clock. */
export const EARLY_WARNING_AT = 18 * 60;
/** After a warning of a kind, the same kind waits this many calendar days. */
export const WARNING_COOLDOWN_DAYS = 7;
