/** Pure helpers for WhatsApp messages (NTF). */

/** Fills {{name}} placeholders; a missing parameter is an error, never an empty gap in a sent message. */
export function renderTemplate(body: string, params: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`template parameter missing: ${name}`);
    return value;
  });
}

/** Parameters in the order the provider template expects. */
export function orderedParams(names: readonly string[], params: Record<string, string>): string[] {
  return names.map((name) => {
    const value = params[name];
    if (value === undefined) throw new Error(`template parameter missing: ${name}`);
    return value;
  });
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** "2026-11-16" -> "Senin, 16 November 2026". */
export function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "16 November 2026" or "16 - 18 November 2026" (izin ranges). */
export function dateRangeLabel(start: string, end: string): string {
  const [a, b] = [new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`)];
  const full = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (start === end) return full(a);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} - ${full(b)}`;
  return `${full(a)} - ${full(b)}`;
}

/** No messages to parents between 21.00 and 06.00 school time; they wait for the morning. */
export const QUIET_HOURS = { start: 21 * 60, end: 6 * 60 } as const;

/**
 * When a message created at `now` may go out: now, or 06.00 school time when now is in the
 * quiet hours. `minutes` is the school clock at now (schoolMinutes).
 */
export function releaseTime(now: Date, minutes: number): Date {
  const quiet = minutes >= QUIET_HOURS.start || minutes < QUIET_HOURS.end;
  if (!quiet) return now;
  const wait = (minutes >= QUIET_HOURS.start ? 24 * 60 - minutes + QUIET_HOURS.end : QUIET_HOURS.end - minutes) * 60_000;
  // Whole minutes: drop the seconds of now so the release lands on 06.00 exactly.
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + wait);
}

export { maskPhone } from '@absah/contracts';
