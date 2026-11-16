/** The calendar date (YYYY-MM-DD) at `now` in the school's timezone (CLAUDE.md rule 8). */
export function schoolDate(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes since local midnight at `now` in the school's timezone (05.00 -> 300). */
export function schoolMinutes(timezone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (type: 'hour' | 'minute') => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}
