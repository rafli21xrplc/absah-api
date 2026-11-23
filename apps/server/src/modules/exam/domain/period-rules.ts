/** The dates and rule fields of a period after an edit: the problem, as a message, or null. */
export function periodProblem(p: { startsOn: string; endsOn: string; attendanceFrom: string | null; requirePaid: boolean; feeTypeIds: string[] }): string | null {
  if (p.endsOn < p.startsOn) return 'Tanggal selesai sebelum tanggal mulai.';
  if (p.attendanceFrom && p.attendanceFrom > p.startsOn) return 'Penghitungan kehadiran harus dimulai sebelum ujian.';
  if (!p.requirePaid && p.feeTypeIds.length > 0) return 'Pilih jenis tagihan hanya bila syarat lunas dipakai.';
  return null;
}
