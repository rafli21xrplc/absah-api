import { describe, expect, it } from 'vitest';
import { parseDay, planScheduleImport, type ScheduleImportContext, type ScheduleRow } from './schedule-import';

const ctx = (over: Partial<ScheduleImportContext> = {}): ScheduleImportContext => ({
  classes: [
    { id: 'c1', name: 'VII A' },
    { id: 'c2', name: 'VII B' },
  ],
  subjects: [{ id: 'm1', name: 'Matematika' }],
  teachers: [
    { id: 't1', name: 'Pak Andi' },
    { id: 't2', name: 'Bu Sari' },
  ],
  periods: new Set(['1:1', '1:2', '2:1']),
  kept: [],
  studentsOf: () => new Set(),
  ...over,
});

let n = 1;
const row = (className: string, day: string, period: string, subject: string, teacher = ''): ScheduleRow => ({ row: ++n, className, day, period, subject, teacher });

describe('parseDay', () => {
  it('reads names in any case and ISO numbers', () => {
    expect(['Senin', 'jumat', "JUM'AT", '6', 'Minggu', 'Libur'].map(parseDay)).toEqual([1, 5, 5, 6, 7, null]);
  });
});

describe('planScheduleImport', () => {
  it('plans lessons, matches names loosely and lists new subjects once', () => {
    const plan = planScheduleImport(
      [row('vii a', 'Senin', '1', 'matematika', 'pak andi'), row('VII A', 'Senin', '2', 'Seni Budaya'), row('VII B', 'Selasa', '1', 'Seni Budaya', 'Bu Sari')],
      ctx(),
    );
    expect(plan.errors).toEqual([]);
    expect(plan.classIds).toEqual(['c1', 'c2']);
    expect(plan.newSubjects).toEqual(['Seni Budaya']);
    expect(plan.lessons.map((l) => [l.ownerName, l.day, l.period, l.subjectId, l.subjectName, l.teacherId])).toEqual([
      ['VII A', 1, 1, 'm1', 'Matematika', 't1'],
      ['VII A', 1, 2, null, 'Seni Budaya', null],
      ['VII B', 2, 1, null, 'Seni Budaya', 't2'],
    ]);
  });

  it('reports unknown rombel, days, periods, teachers and empty subjects per row', () => {
    n = 1;
    const plan = planScheduleImport([row('IX Z', 'Senen', 'satu', ''), row('VII A', 'Rabu', '1', 'Matematika', 'Pak Budi')], ctx());
    expect(plan.lessons).toEqual([]);
    expect(plan.errors).toEqual([
      { row: 2, message: 'Rombel "IX Z" tidak ada di tahun ajaran aktif.' },
      { row: 2, message: 'Hari "Senen" tidak dikenali.' },
      { row: 2, message: 'Jam ke "satu" harus angka.' },
      { row: 2, message: 'Mapel kosong.' },
      { row: 3, message: 'Jam ke-1 belum diatur untuk hari itu.' },
      { row: 3, message: 'Guru "Pak Budi" bukan staf aktif sekolah.' },
    ]);
  });

  it('finds clashes inside the file and with group lessons that stay', () => {
    n = 1;
    const kept = [
      { id: 'k1', ownerType: 'group' as const, ownerId: 'g1', ownerName: 'Informatika A', day: 1, period: 2, teacherId: null },
      { id: 'k2', ownerType: 'class' as const, ownerId: 'c1', ownerName: 'VII A', day: 2, period: 1, teacherId: 't2' },
    ];
    const studentsOf = (o: { ownerId: string }) => new Set(o.ownerId === 'c1' || o.ownerId === 'g1' ? ['s1'] : []);
    const plan = planScheduleImport(
      [
        row('VII A', 'Senin', '1', 'Matematika', 'Pak Andi'),
        row('VII B', 'Senin', '1', 'Matematika', 'Pak Andi'),
        row('VII A', 'Senin', '1', 'IPA'),
        row('VII A', 'Senin', '2', 'IPA'),
        row('VII B', 'Selasa', '1', 'IPA', 'Bu Sari'),
      ],
      ctx({ kept, studentsOf }),
    );
    expect(plan.errors).toEqual([
      { row: 3, message: 'Guru yang sama juga mengajar VII A (baris 2) di jam ini.' },
      { row: 4, message: 'VII A sudah punya pelajaran di jam ini (baris 2).' },
      { row: 5, message: '1 siswa juga punya pelajaran Informatika A di jam ini.' },
    ]);
  });
});
