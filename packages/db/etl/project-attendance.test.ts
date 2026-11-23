import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { parseValues, readDump } from './mysql-dump';
import { LEGACY_TABLES, legacyGrade, legacyNisn, legacyPhone, legacyStream, mapProjectAttendance } from './project-attendance';

const DUMP = readFileSync(new URL('../fixtures/project-attendance/dump.sql', import.meta.url), 'utf8');

describe('readDump', () => {
  it('parses mysqldump values: quotes, escapes, NULL, numbers', () => {
    expect(parseValues(`(1,'a\\'b',NULL),(2,'it''s, (ok)',3.5)`)).toEqual([
      ['1', "a'b", null],
      ['2', "it's, (ok)", '3.5'],
    ]);
  });

  it('takes column names from CREATE TABLE and reads every INSERT of a table', () => {
    const tables = readDump(DUMP);
    expect(tables.get('student')).toHaveLength(10);
    expect(tables.get('student')?.[1]).toMatchObject({ id: 's2', name: "DINDA O'BRIEN", day_of_birth: '0000-00-00', telp: null, classroom_id: 'c1' });
    expect(readDump(DUMP, ['teacher']).size).toBe(1);
  });

  it('uses the column list of an INSERT when there is one', () => {
    expect(readDump("INSERT INTO `t` (`b`, `a`) VALUES ('x', 1);").get('t')).toEqual([{ b: 'x', a: '1' }]);
  });
});

describe('legacy values', () => {
  it('reads grades, streams, NISN and phone numbers', () => {
    expect([legacyGrade('X'), legacyGrade(' xii '), legacyGrade('7'), legacyGrade('Alumni')]).toEqual([10, 12, 7, null]);
    expect([legacyStream('X MIPA 2'), legacyStream('XI IPS 1'), legacyStream('X-3')]).toEqual(['ipa', 'ips', null]);
    expect([legacyNisn('991310001'), legacyNisn('0'), legacyNisn('12345678901'), legacyNisn(null)]).toEqual(['0991310001', null, null, null]);
    expect([legacyPhone('0812-1100-0001'), legacyPhone('62813110000003'), legacyPhone('021555'), legacyPhone(null)]).toEqual(['+6281211000001', '+62813110000003', null, null]);
  });
});

describe('mapProjectAttendance', () => {
  const plan = mapProjectAttendance(readDump(DUMP, LEGACY_TABLES), { yearStartsOn: '2026-07-13', existingNisns: new Set(['9913100009']) });

  it('maps rombel by grade category + name, wali kelas by name', () => {
    expect(plan.classes).toEqual([
      { legacyId: 'c1', name: 'X IPA 1', grade: 10, stream: 'ipa', homeroom: 'BUDI SANTOSA, S.Pd.' },
      { legacyId: 'c2', name: 'XI IPS 1', grade: 11, stream: 'ips', homeroom: "SITI NUR'AINI" },
    ]);
  });

  it('moves current students with the date they joined the rombel', () => {
    expect(plan.students.map((s) => [s.nisn, s.name, s.className, s.startsOn, s.birthDate])).toEqual([
      ['0991310001', 'ADITYA PRATAMA', 'X IPA 1', '2026-07-13', '2010-02-11'],
      ['9913100002', "DINDA O'BRIEN", 'X IPA 1', '2026-07-13', null],
      ['9913100003', 'CITRA LESTARI', 'XI IPS 1', '2026-07-13', '2009-05-01'],
      ['9913100008', 'PINDAHAN SEPTEMBER', 'XI IPS 1', '2026-09-01', '2009-09-09'],
    ]);
    expect(plan.skipped).toEqual({ graduated: 1, existing: 1, attendanceRows: 3 });
  });

  it('reports every row it cannot map', () => {
    expect(plan.failures.map((f) => [f.table, f.legacyId, f.reason])).toEqual([
      ['class_room', 'c3', 'tingkat_tidak_dikenal'],
      ['class_room', 'c4', 'rombel_ganda'],
      ['student', 's4', 'nisn_ganda'],
      ['student', 's5', 'nisn_tidak_valid'],
      ['student', 's6', 'rombel_tidak_ditemukan'],
      ['student', 's10', 'nisn_tidak_valid'],
    ]);
  });

  it('lists teachers to invite again and never carries old passwords', () => {
    expect(plan.teachers.map((t) => [t.name, t.nip, t.phone, t.homeroomOf])).toEqual([
      ['BUDI SANTOSA, S.Pd.', '199001012020011001', '+6281211000001', ['X IPA 1']],
      ["SITI NUR'AINI", null, null, ['XI IPS 1']],
      ['RINA WATI', '199202022020012002', '+62813110000003', []],
    ]);
    expect(JSON.stringify(plan)).not.toContain('$2y$');
  });
});

describe('toCsv', () => {
  it('quotes and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=SUM(A1)'], [null, 3]])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n,3\r\n');
  });
});
