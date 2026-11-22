/** Minutes after midnight from "HH:MM" (or "HH:MM:SS"). */
export const minutesOfClock = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * A teacher is late when they check in after the school start. The minute of the start itself is on time, the same
 * rule as a student's gate arrival (gateStatusFor).
 */
export const isLate = (checkedInMinutes: number, schoolStart: string): boolean => checkedInMinutes > minutesOfClock(schoolStart);
