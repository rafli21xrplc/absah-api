import type { TeacherDayStatus } from '@absah/contracts';

export interface DayRecord {
  date: string;
  status: TeacherDayStatus;
}

export interface MonthCounts {
  present: number;
  late: number;
  leave: { sakit: number; izin: number; dinas: number };
  noRecord: number;
}

/**
 * One teacher's school days of a month. Checking in wins over an izin (they came), then an approved izin, and a day
 * with neither is "none": the school sees it and asks, the system does not call it alpa.
 */
export function classifyDays(input: {
  schoolDays: readonly string[];
  checkIns: readonly { date: string; late: boolean }[];
  leaves: readonly { kind: 'sakit' | 'izin' | 'dinas'; startsOn: string; endsOn: string }[];
}): { days: DayRecord[]; counts: MonthCounts } {
  const checkIn = new Map(input.checkIns.map((c) => [c.date, c.late]));
  const counts: MonthCounts = { present: 0, late: 0, leave: { sakit: 0, izin: 0, dinas: 0 }, noRecord: 0 };
  const days: DayRecord[] = input.schoolDays.map((date) => {
    const late = checkIn.get(date);
    if (late !== undefined) {
      counts.present += 1;
      if (late) counts.late += 1;
      return { date, status: late ? 'late' : 'present' };
    }
    const leave = input.leaves.find((l) => l.startsOn <= date && date <= l.endsOn);
    if (leave) {
      counts.leave[leave.kind] += 1;
      return { date, status: leave.kind };
    }
    counts.noRecord += 1;
    return { date, status: 'none' };
  });
  return { days, counts };
}

/** present / school days as a percentage with one decimal; null without a school day. */
export function presenceRate(present: number, schoolDays: number): number | null {
  return schoolDays === 0 ? null : Math.round((present / schoolDays) * 1000) / 10;
}

/** The first and last date of a YYYY-MM month, and the last one to count: the end of the month or today, whichever is earlier. */
export function monthSpan(month: string, today: string): { from: string; to: string; through: string | null } {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(last).padStart(2, '0')}`;
  const through = today < from ? null : today < to ? today : to;
  return { from, to, through };
}
