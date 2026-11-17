import ExcelJS from 'exceljs';
import type { SemesterRecap } from '../../../domain/semester-recap';
import { ERAPOR_COLUMNS } from './columns';

/** Excel sheet names: at most 31 characters, no []:*?/\ and unique in the workbook. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 28) || 'Rombel';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** The import file: one sheet per rombel, header row then one row per student. */
export async function eraporWorkbook(recap: SemesterRecap): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absah';
  workbook.title = `Ketidakhadiran semester ${recap.semester.number} ${recap.semester.academicYear}`;
  const used = new Set<string>();
  for (const cls of recap.classes) {
    const sheet = workbook.addWorksheet(sheetName(cls.name, used));
    sheet.columns = ERAPOR_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    cls.students.forEach((s, i) => sheet.addRow(ERAPOR_COLUMNS.map((c) => c.value(s, i + 1))));
    // NIS and NISN keep their leading zeros.
    for (const col of [2, 3]) sheet.getColumn(col).numFmt = '@';
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  if (recap.classes.length === 0) workbook.addWorksheet('Kosong').addRow(['Tidak ada siswa pada semester ini.']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
