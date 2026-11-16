import { dapodikFixture } from '@absah/db/fixtures';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ImportFormatError } from '../../../domain/student-import';
import { DapodikImporter } from './dapodik-importer';

const importer = new DapodikImporter();
const parse = async (file: 'daftar-pd-awal.xlsx' | 'daftar-pd-perubahan.xlsx') => importer.parse(await readFile(dapodikFixture(file)));

async function xlsx(rows: unknown[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('DapodikImporter', () => {
  it('reads the Dapodik layout: title rows, two-row header, merged parent groups', async () => {
    const { rows, issues } = await parse('daftar-pd-awal.xlsx');
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      row: 7,
      name: 'ADITYA PRATAMA',
      nisn: '0131000001',
      nik: '9901010211130001',
      localId: '2601',
      gender: 'L',
      birthPlace: 'Bandung',
      birthDate: '2013-02-11',
      className: 'VII A',
      guardians: [
        { relation: 'ayah', name: 'BAMBANG SURYADI' },
        { relation: 'ibu', name: 'SITI AMINAH' },
      ],
    });
  });

  it('repairs what Excel does to identifiers and dates', async () => {
    const { rows } = await parse('daftar-pd-awal.xlsx');
    const by = (name: string) => rows.find((r) => r.name === name);
    expect(by('CANDRA KIRANA')).toMatchObject({ nisn: '0131000003', birthDate: '2013-06-14' }); // numeric NISN, dd/mm/yyyy
    expect(by('DIMAS ANGGARA')?.birthDate).toBe('2013-01-30'); // real date cell
    expect(by('FAJAR NUGROHO')?.guardians.map((g) => g.relation)).toEqual(['ayah', 'ibu', 'wali']);
    expect(by('JAJANG MULYANA')).toMatchObject({ nisn: null, nik: null });
  });

  it('reads flat headers and reports bad values per row without stopping', async () => {
    const file = await xlsx([
      ['Nama', 'NISN', 'NIK', 'JK', 'Tanggal Lahir', 'Rombel', 'Nama Ibu'],
      ['ANI', '12345', Number('9901010101130001'), 'X', '31/02/2013', '1A', 'IBU ANI'],
      ['', '0131000099', '', 'L', '', '1A', ''],
      ['', '', '', '', '', '', ''],
      ['BUDI', '0131000002', '', 'Laki-laki', '2013-01-01', '', '-'],
    ]);
    const { rows, issues } = await importer.parse(file);
    expect(rows.map((r) => [r.name, r.nisn, r.gender, r.birthDate, r.className, r.guardians.length])).toEqual([
      ['ANI', null, null, null, '1A', 1],
      ['BUDI', '0131000002', 'L', '2013-01-01', null, 0],
    ]);
    expect(issues.map((i) => [i.row, i.field, i.severity])).toEqual([
      [2, 'nisn', 'warning'],
      [2, 'nik', 'warning'],
      [2, 'gender', 'warning'],
      [2, 'birthDate', 'warning'],
      [3, 'name', 'error'],
      [5, 'className', 'warning'],
    ]);
    expect(issues[1]?.message).toContain('angka');
  });

  it('refuses files that are not a Dapodik student export', async () => {
    await expect(importer.parse(new TextEncoder().encode('nama,nisn'))).rejects.toThrow(ImportFormatError);
    await expect(importer.parse(await xlsx([['Kode', 'Barang']]))).rejects.toThrow(/Nama/);
    await expect(importer.parse(await xlsx([['Nama', 'NISN'], ['ANI', '0131000001']]))).rejects.toThrow(/Rombel/);
  });
});
