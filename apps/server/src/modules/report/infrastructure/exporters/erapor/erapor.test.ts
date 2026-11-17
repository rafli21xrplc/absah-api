import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { SemesterRecap } from '../../../domain/semester-recap';
import { ERAPOR_COLUMNS } from './columns';
import { eraporExporter } from './index';
import { tanggal } from './pdf';

const recap: SemesterRecap = {
  school: { name: 'SMA Uji', npsn: '99999999' },
  semester: { academicYear: '2026/2027', number: 2, startsOn: '2027-01-04', endsOn: '2027-06-19' },
  principalName: 'Kepala Uji',
  signedOn: '2027-06-20',
  classes: [
    {
      name: 'X-1',
      grade: 10,
      homeroomName: 'Wali Uji',
      students: [
        { name: 'ANI LESTARI', nisn: '0091234567', localId: '0012', counts: { H: 100, T: 2, S: 3, I: 1, A: 0 } },
        { name: 'BUDI SANTOSO', nisn: null, localId: null, counts: { H: 99, T: 0, S: 0, I: 4, A: 2 } },
      ],
    },
    // 60 students: the PDF table runs onto a second page.
    { name: 'X/2', grade: 10, homeroomName: null, students: Array.from({ length: 60 }, (_, i) => ({ name: `SISWA ${i + 1}`, nisn: null, localId: null, counts: { H: 1, T: 0, S: 0, I: 0, A: 0 } })) },
  ],
};

describe('e-Rapor exporter', () => {
  it('writes one sheet per rombel with the e-Rapor columns', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await eraporExporter.build(recap, 'xlsx')) as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['X-1', 'X-2']);
    const sheet = workbook.getWorksheet('X-1');
    expect(sheet?.getRow(1).values).toEqual([undefined, ...ERAPOR_COLUMNS.map((c) => c.header)]);
    expect(sheet?.getRow(2).values).toEqual([undefined, 1, '0012', '0091234567', 'ANI LESTARI', 3, 1, 0]);
    expect(sheet?.getRow(3).values).toEqual([undefined, 2, '', '', 'BUDI SANTOSO', 0, 4, 2]);
    expect(workbook.getWorksheet('X-2')?.rowCount).toBe(61);
  });

  it('writes a PDF with one section per rombel', async () => {
    const pdf = await eraporExporter.build(recap, 'pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it('writes dates in Indonesian', () => {
    expect(tanggal('2027-06-19')).toBe('19 Juni 2027');
    expect(tanggal('2027-01-04')).toBe('4 Januari 2027');
  });
});
