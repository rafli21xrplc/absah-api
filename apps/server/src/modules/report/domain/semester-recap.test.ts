import { describe, expect, it } from 'vitest';
import { exportFileName, semesterStudentsByClass, type EnrollmentDays } from './semester-recap';

const row = (studentId: string, classId: string, startsOn: string, status: EnrollmentDays['status'], days: Partial<EnrollmentDays['counts']>): EnrollmentDays => ({
  studentId,
  name: studentId.toUpperCase(),
  nisn: null,
  localId: null,
  classId,
  startsOn,
  status,
  counts: { H: 0, T: 0, S: 0, I: 0, A: 0, ...days },
});

describe('semesterStudentsByClass', () => {
  it('sums a moved student under the rombel they ended in', () => {
    const byClass = semesterStudentsByClass([
      row('citra', 'a', '2026-07-13', 'class_changed', { H: 30, S: 1 }),
      row('citra', 'b', '2027-02-01', 'active', { H: 40, A: 2 }),
      row('ani', 'a', '2026-07-13', 'active', { H: 70, I: 1 }),
    ]);
    expect(byClass.get('a')?.map((s) => [s.name, s.counts])).toEqual([['ANI', { H: 70, T: 0, S: 0, I: 1, A: 0 }]]);
    expect(byClass.get('b')?.map((s) => [s.name, s.counts])).toEqual([['CITRA', { H: 70, T: 0, S: 1, I: 0, A: 2 }]]);
  });

  it('leaves out students who left the school', () => {
    const byClass = semesterStudentsByClass([row('dodi', 'a', '2026-07-13', 'moved', { H: 10 }), row('eka', 'a', '2026-07-13', 'left', { A: 3 })]);
    expect(byClass.size).toBe(0);
  });

  it('orders students by name', () => {
    const byClass = semesterStudentsByClass([row('zaki', 'a', '2026-07-13', 'active', {}), row('bima', 'a', '2026-07-13', 'active', {})]);
    expect(byClass.get('a')?.map((s) => s.name)).toEqual(['BIMA', 'ZAKI']);
  });
});

describe('exportFileName', () => {
  const recap = { semester: { academicYear: '2026/2027', number: 2, startsOn: '2027-01-04', endsOn: '2027-06-19' } };
  it('names one rombel or the whole school', () => {
    expect(exportFileName(recap, 'X IPA 1', 'xlsx')).toBe('rekap-kehadiran-2026-2027-sem2-X-IPA-1.xlsx');
    expect(exportFileName(recap, null, 'pdf')).toBe('rekap-kehadiran-2026-2027-sem2-semua-rombel.pdf');
  });
});
