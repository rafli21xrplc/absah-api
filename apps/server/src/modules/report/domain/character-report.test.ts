import type { AttendanceCounts } from '@absah/contracts';
import { describe, expect, it } from 'vitest';
import { characterFileName, characterRoster, habitPredicate, habitRate, mergeActivities, sumHabits } from './character-report';
import type { EnrollmentDays } from './semester-recap';

const counts = (H: number, A = 0): AttendanceCounts => ({ H, T: 0, S: 0, I: 0, A });
const enrollment = (o: Partial<EnrollmentDays> & { enrollmentId: string; studentId: string; classId: string; startsOn: string }) => ({
  name: o.studentId.toUpperCase(),
  nisn: null,
  localId: null,
  status: 'active' as const,
  counts: counts(0),
  ...o,
});

describe('characterRoster (KEG-04)', () => {
  it('puts a student on the rombel they ended in, sums their enrollments, drops leavers, sorts by name', () => {
    const roster = characterRoster(
      [
        enrollment({ enrollmentId: 'e1', studentId: 'citra', classId: 'A', startsOn: '2026-07-13', status: 'class_changed', counts: counts(10, 1) }),
        enrollment({ enrollmentId: 'e2', studentId: 'citra', classId: 'B', startsOn: '2026-09-01', counts: counts(20) }),
        enrollment({ enrollmentId: 'e3', studentId: 'budi', classId: 'B', startsOn: '2026-07-13', counts: counts(25, 2) }),
        enrollment({ enrollmentId: 'e4', studentId: 'ani', classId: 'B', startsOn: '2026-07-13', status: 'moved', counts: counts(5) }),
        enrollment({ enrollmentId: 'e5', studentId: 'dewi', classId: 'A', startsOn: '2026-07-13', counts: counts(30) }),
      ],
      'B',
    );
    expect(roster.map((r) => r.name)).toEqual(['BUDI', 'CITRA']);
    expect(roster[1]).toMatchObject({ enrollmentIds: ['e1', 'e2'], counts: { H: 30, A: 1 } });
  });
});

describe('habits (KAIH)', () => {
  it('adds tallies of a student’s enrollments for all 7 habits, in order', () => {
    const total = sumHabits([[{ habit: 'beribadah', yes: 8, filled: 10 }], [{ habit: 'beribadah', yes: 2, filled: 5 }, { habit: 'tidur_cepat', yes: 1, filled: 1 }]]);
    expect(total.map((t) => t.habit)).toEqual(['bangun_pagi', 'beribadah', 'berolahraga', 'makan_sehat', 'gemar_belajar', 'bermasyarakat', 'tidur_cepat']);
    expect(total.find((t) => t.habit === 'beribadah')).toEqual({ habit: 'beribadah', yes: 10, filled: 15 });
    expect(total.find((t) => t.habit === 'bangun_pagi')).toEqual({ habit: 'bangun_pagi', yes: 0, filled: 0 });
  });

  it('says "belum diisi" for a habit never filled, never 0%', () => {
    expect(habitRate({ yes: 0, filled: 0 })).toBeNull();
    expect(habitPredicate(null)).toBe('Belum diisi');
    expect(habitRate({ yes: 2, filled: 3 })).toBe(0.67);
    expect([0.95, 0.8, 0.6, 0.2].map(habitPredicate)).toEqual(['Sangat baik', 'Baik', 'Cukup', 'Perlu dibina']);
  });
});

describe('mergeActivities and file name', () => {
  it('merges one activity across enrollments', () => {
    const a = { activityId: 'x', name: 'Pramuka', kind: 'ekskul', recorded: 4, present: 3 };
    expect(mergeActivities([[a], [{ ...a, recorded: 2, present: 2 }, { ...a, activityId: 'y', name: 'Futsal' }]])).toEqual([
      { name: 'Futsal', kind: 'ekskul', recorded: 4, present: 3 },
      { name: 'Pramuka', kind: 'ekskul', recorded: 6, present: 5 },
    ]);
  });

  it('names the file after the year, semester and rombel', () => {
    expect(characterFileName({ semester: { academicYear: '2026/2027', number: 1, startsOn: '', endsOn: '' }, className: 'X IPA 1' })).toBe('rapor-karakter-2026-2027-sem1-X-IPA-1.pdf');
  });
});
