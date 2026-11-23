import { LEAVE_MAX_BACKDATE_DAYS, LEAVE_MAX_DAYS, type LeaveKind } from '@absah/contracts';

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Problems with the dates of a request, as { path, message } for a 400. Empty when fine. */
export function checkLeaveDates(input: { startsOn: string; endsOn: string }, today: string): { path: string; message: string }[] {
  if (input.endsOn < input.startsOn) return [{ path: 'endsOn', message: 'Tanggal selesai sebelum tanggal mulai.' }];
  const problems = [];
  if (days(input.startsOn, input.endsOn) + 1 > LEAVE_MAX_DAYS) problems.push({ path: 'endsOn', message: `Izin paling lama ${LEAVE_MAX_DAYS} hari per pengajuan.` });
  if (days(input.startsOn, today) > LEAVE_MAX_BACKDATE_DAYS) {
    problems.push({ path: 'startsOn', message: `Izin hanya bisa diajukan mundur ${LEAVE_MAX_BACKDATE_DAYS} hari.` });
  }
  return problems;
}

/** The attendance status an approved request writes. */
export const leaveStatusOf = (kind: LeaveKind) => (kind === 'sakit' ? ('S' as const) : ('I' as const));

/** Two date ranges (inclusive) share at least one day. */
export const overlaps = (a: { startsOn: string; endsOn: string }, b: { startsOn: string; endsOn: string }) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
