/** Minutes after midnight from "HH:MM". */
export const minutesOf = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** When school starts if there are no jam pelajaran for the weekday. */
export const DEFAULT_SCHOOL_START = '07:00';

/**
 * What a gate arrival says about one session (source gate, below the teacher):
 * - daily session: H, or T after the school start;
 * - lesson: H when in before it starts, T when it is under way, nothing once it is over
 *   (the student missed it; the teacher decides).
 */
export function gateStatusFor(
  session: { mode: string; startsAt: string | null; endsAt: string | null },
  arrivedAt: number,
  schoolStart: number,
): 'H' | 'T' | null {
  if (session.mode !== 'per_period' || !session.startsAt || !session.endsAt) return arrivedAt <= schoolStart ? 'H' : 'T';
  if (arrivedAt <= minutesOf(session.startsAt)) return 'H';
  return arrivedAt < minutesOf(session.endsAt) ? 'T' : null;
}
