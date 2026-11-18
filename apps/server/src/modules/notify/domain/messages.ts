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

/** Local minutes [start, end) in which a message may go out. */
export interface SendWindow {
  start: number;
  end: number;
}
const OUTSIDE_QUIET_HOURS: SendWindow = { start: QUIET_HOURS.end, end: QUIET_HOURS.start };

/**
 * When a message created at `now` may go out: now inside the window (default: outside the quiet
 * hours), else the next window start, school time. `minutes` is the school clock at now
 * (schoolMinutes). A window narrower than the quiet hours (buku penghubung service hours) is
 * clamped into them, so no message goes out at night.
 */
export function releaseTime(now: Date, minutes: number, window: SendWindow = OUTSIDE_QUIET_HOURS): Date {
  const start = Math.max(window.start, OUTSIDE_QUIET_HOURS.start);
  const end = Math.min(window.end, OUTSIDE_QUIET_HOURS.end);
  if (minutes >= start && minutes < end) return now;
  const wait = (minutes < start ? start - minutes : 24 * 60 - minutes + start) * 60_000;
  // Whole minutes: drop the seconds of now so the release lands on 06.00 exactly.
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + wait);
}

export { maskPhone } from '@absah/contracts';

/**
 * The per-rombel part of the MBG message, one line (WhatsApp template parameters cannot hold line
 * breaks): "VII A 28, VII B 25 (3 belum diisi)". Unrecorded students are named so the PIC knows the
 * number may still rise.
 */
export function mbgClassesLine(rows: readonly { name: string; present: number; unrecorded: number }[]): string {
  if (rows.length === 0) return '-';
  return rows.map((r) => (r.unrecorded > 0 ? `${r.name} ${r.present} (${r.unrecorded} belum diisi)` : `${r.name} ${r.present}`)).join(', ');
}

/** Minutes since midnight on the school clock -> "10.35" (Indonesian style). */
export function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}.${String(minutes % 60).padStart(2, '0')}`;
}
