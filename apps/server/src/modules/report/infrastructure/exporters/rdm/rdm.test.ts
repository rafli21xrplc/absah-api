import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { SemesterRecap } from '../../../domain/semester-recap';
import { exporterFor } from '../index';
import { RDM_COLUMNS } from './columns';

const recap: SemesterRecap = {
  school: { name: 'MA Uji', npsn: '99999998' },
  semester: { academicYear: '2026/2027', number: 1, startsOn: '2026-07-13', endsOn: '2026-12-19' },
  principalName: null,
  signedOn: '2026-12-20',
  classes: [{ name: 'X IPA 1', grade: 10, homeroomName: 'Wali MA', students: [{ name: 'AHMAD FAUZAN', nisn: '0081000001', localId: '024001', counts: { H: 90, T: 1, S: 2, I: 1, A: 3 } }] }],
};

describe('RDM exporter (RKP-07, TODO(pilot) columns)', () => {
  it('is the exporter for target rdm and writes the madrasah sheet', async () => {
    const rdm = exporterFor('rdm');
    expect(rdm?.target).toBe('rdm');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await rdm?.build(recap, 'xlsx')) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('X IPA 1');
    expect(sheet?.getRow(1).values).toEqual([undefined, ...RDM_COLUMNS.map((c) => c.header)]);
    expect(sheet?.getRow(2).values).toEqual([undefined, 1, '024001', '0081000001', 'AHMAD FAUZAN', 2, 1, 3]);
  });

  it('signs the PDF as kepala madrasah', async () => {
    const pdf = await exporterFor('rdm')?.build(recap, 'pdf');
    expect(pdf?.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
