import { LEAVE_MAX_BACKDATE_DAYS, LEAVE_MAX_DAYS } from '@absah/contracts';

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Problems with the dates of a teacher's izin, as { path, message } for a 400. Empty when fine. Same limits as a student's izin. */
export function checkTeacherLeaveDates(input: { startsOn: string; endsOn: string }, today: string): { path: string; message: string }[] {
  if (input.endsOn < input.startsOn) return [{ path: 'endsOn', message: 'Tanggal selesai sebelum tanggal mulai.' }];
  const problems = [];
  if (days(input.startsOn, input.endsOn) + 1 > LEAVE_MAX_DAYS) problems.push({ path: 'endsOn', message: `Izin paling lama ${LEAVE_MAX_DAYS} hari per pengajuan.` });
  if (days(input.startsOn, today) > LEAVE_MAX_BACKDATE_DAYS) problems.push({ path: 'startsOn', message: `Izin hanya bisa diajukan mundur ${LEAVE_MAX_BACKDATE_DAYS} hari.` });
  return problems;
}

/** A izin can be withdrawn while pending, or approved and not over yet. */
export const mayCancelLeave = (leave: { status: string; endsOn: string }, today: string): boolean =>
  (leave.status === 'pending' || leave.status === 'approved') && leave.endsOn >= today;
