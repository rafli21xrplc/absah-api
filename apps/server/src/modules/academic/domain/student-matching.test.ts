import { describe, expect, it } from 'vitest';
import { planStudentImport, type ExistingStudent, type IncomingStudent } from './student-matching';

const existing = (over: Partial<ExistingStudent> & { id: string }): ExistingStudent => ({
  name: 'Siswa',
  nisn: null,
  nikHash: null,
  localId: null,
  gender: 'L',
  birthPlace: null,
  birthDate: '2013-01-01',
  enrollment: { id: `e-${over.id}`, className: 'VII A', missingSince: null },
  ...over,
});

let row = 0;
const incoming = (over: Partial<IncomingStudent>): IncomingStudent => ({
  row: ++row,
  name: 'Siswa',
  nisn: null,
  nik: null,
  nikHash: null,
  localId: null,
  gender: 'L',
  birthPlace: null,
  birthDate: '2013-01-01',
  className: 'VII A',
  guardians: [],
  ...over,
});

describe('planStudentImport', () => {
  it('matches by NISN, then NIK, then name + birth date', () => {
    const plan = planStudentImport(
      [
        existing({ id: 'a', name: 'ANI', nisn: '0000000001' }),
        existing({ id: 'b', name: 'BUDI', nikHash: 'h-b' }),
        existing({ id: 'c', name: 'CICI', birthDate: '2013-03-03' }),
      ],
      [
        incoming({ name: 'ANI', nisn: '0000000001' }),
        incoming({ name: 'BUDI', nik: '9901010101130002', nikHash: 'h-b' }),
        incoming({ name: 'Cici ', birthDate: '2013-03-03' }),
      ],
    );
    expect(plan.unchanged.map((m) => [m.studentId, m.matchedBy])).toEqual([
      ['a', 'nisn'],
      ['b', 'nik'],
    ]);
    // "Cici " differs from "CICI" only in case and spacing: matched, and the file's spelling wins.
    expect(plan.changed.map((m) => [m.studentId, m.matchedBy, m.changes])).toEqual([
      ['c', 'name_birthdate', [{ field: 'name', from: 'CICI', to: 'Cici ' }]],
    ]);
    expect(plan.created).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it('is idempotent: the same rows against their result change nothing', () => {
    const plan = planStudentImport(
      [existing({ id: 'a', name: 'ANI', nisn: '0000000001', nikHash: 'h-a' })],
      [incoming({ name: 'ANI', nisn: '0000000001', nik: '9901010101130001', nikHash: 'h-a' })],
    );
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.changed).toHaveLength(0);
    expect(plan.created).toHaveLength(0);
  });

  it('reports class moves and new values, but never erases with blanks', () => {
    const plan = planStudentImport(
      [existing({ id: 'a', name: 'ANI', nisn: '0000000001', birthPlace: 'Bogor' })],
      [incoming({ name: 'ANI', nisn: '0000000001', birthPlace: null, className: 'VII B' })],
    );
    expect(plan.changed[0]?.changes).toEqual([{ field: 'className', from: 'VII A', to: 'VII B' }]);
  });

  it('flags active students missing from the file as calon keluar', () => {
    const plan = planStudentImport(
      [existing({ id: 'a', nisn: '0000000001' }), existing({ id: 'b', nisn: '0000000002' }), existing({ id: 'old', nisn: '0000000003', enrollment: null })],
      [incoming({ nisn: '0000000001' })],
    );
    expect(plan.missing.map((s) => s.id)).toEqual(['b']);
  });

  it('creates rows with no match', () => {
    const plan = planStudentImport([existing({ id: 'a', name: 'ANI', nisn: '0000000001' })], [incoming({ name: 'DEDI', nisn: '0000000009' })]);
    expect(plan.created.map((r) => r.name)).toEqual(['DEDI']);
  });

  it('rejects duplicates in the file, ambiguous names and identifiers of two students', () => {
    const plan = planStudentImport(
      [
        existing({ id: 'a', name: 'ANI', nisn: '0000000001' }),
        existing({ id: 'b', name: 'BUDI', nikHash: 'h-b' }),
        existing({ id: 't1', name: 'TONI', birthDate: '2013-05-05' }),
        existing({ id: 't2', name: 'TONI', birthDate: '2013-05-05' }),
      ],
      [
        incoming({ name: 'X', nisn: '0000000007' }),
        incoming({ name: 'Y', nisn: '0000000007' }),
        incoming({ name: 'TONI', birthDate: '2013-05-05' }),
        incoming({ name: 'ANI', nisn: '0000000001', nik: '9901010101130002', nikHash: 'h-b' }),
      ],
    );
    expect(plan.rejected.map((r) => r.message)).toEqual([
      expect.stringContaining('NISN 0000000007'),
      expect.stringContaining('NISN 0000000007'),
      expect.stringContaining('lebih dari satu siswa'),
      expect.stringContaining('dua siswa berbeda'),
    ]);
    expect(plan.created).toEqual([]);
  });

  it('does not match a name whose NISN contradicts the stored one', () => {
    const plan = planStudentImport(
      [existing({ id: 'a', name: 'ANI', nisn: '0000000001' })],
      [incoming({ name: 'ANI', nisn: '0000000002' })],
    );
    expect(plan.created).toHaveLength(1);
    expect(plan.missing.map((s) => s.id)).toEqual(['a']);
  });
});
