import { emisFixture } from '@absah/db/fixtures';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ImportFormatError } from '../../../domain/student-import';
import { EmisImporter } from './emis-importer';

const parse = async (file: Uint8Array) => new EmisImporter().parse(file);

describe('EmisImporter (AKD-09, TODO(pilot) layout)', () => {
  it('reads the fields Absah needs from the EMIS student export', async () => {
    const { rows, issues } = await parse(await readFile(emisFixture('data-siswa.xlsx')));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      row: 6,
      name: 'AHMAD FAUZAN',
      nisn: '0081000001',
      nik: '9901010101080001',
      localId: '24001',
      gender: 'L',
      birthPlace: 'Cirebon',
      birthDate: '2008-01-01',
      className: 'X IPA 1',
      guardians: [
        { relation: 'ayah', name: 'MUHAMMAD SOLEH' },
        { relation: 'ibu', name: 'SITI KHODIJAH' },
      ],
    });
    expect(rows[2]).toMatchObject({ nisn: '0081000003', birthDate: '2008-03-03' }); // NISN stored as a number, dd/mm/yyyy
    expect(rows[4]).toMatchObject({ name: 'FARHAN HIDAYAT', nisn: null, gender: 'L' });
    expect(rows[5]).toMatchObject({ gender: 'P', className: 'XI IPA 1' });
    expect(issues).toEqual([]);
  });

  it('refuses files that are not an EMIS export', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Lain').addRow(['Kode', 'Barang']);
    await expect(parse(new Uint8Array(await wb.xlsx.writeBuffer()))).rejects.toThrow(ImportFormatError);
    await expect(parse(new TextEncoder().encode('bukan xlsx'))).rejects.toThrow('Berkas bukan .xlsx');
  });
});
