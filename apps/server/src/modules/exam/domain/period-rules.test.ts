import { describe, expect, it } from 'vitest';
import { periodProblem } from './period-rules';

const ok = { startsOn: '2026-12-01', endsOn: '2026-12-05', attendanceFrom: null, requirePaid: false, feeTypeIds: [] };

describe('periodProblem', () => {
  it('lets a sound period through', () => {
    expect(periodProblem(ok)).toBeNull();
    expect(periodProblem({ ...ok, attendanceFrom: '2026-07-13', requirePaid: true, feeTypeIds: ['a'] })).toBeNull();
    expect(periodProblem({ ...ok, endsOn: '2026-12-01' })).toBeNull(); // a one-day exam
  });

  it('names what is wrong', () => {
    expect(periodProblem({ ...ok, endsOn: '2026-11-30' })).toBe('Tanggal selesai sebelum tanggal mulai.');
    expect(periodProblem({ ...ok, attendanceFrom: '2026-12-02' })).toBe('Penghitungan kehadiran harus dimulai sebelum ujian.');
    expect(periodProblem({ ...ok, feeTypeIds: ['a'] })).toBe('Pilih jenis tagihan hanya bila syarat lunas dipakai.');
  });
});
