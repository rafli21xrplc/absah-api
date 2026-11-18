import ExcelJS from 'exceljs';
import type { SemesterRecap, SemesterRecapStudent } from '../../../domain/semester-recap';

export interface SheetColumn {
  header: string;
  width: number;
  /** Text columns keep leading zeros (NIS, NISN). */
  text?: boolean;
  value: (s: SemesterRecapStudent, no: number) => string | number;
}

/** Excel sheet names: at most 31 characters, no []:*?/\ and unique in the workbook. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 28) || 'Rombel';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** The import file: one sheet per rombel, header row then one row per student. */
export async function recapWorkbook(recap: SemesterRecap, columns: readonly SheetColumn[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absah';
  workbook.title = `Ketidakhadiran semester ${recap.semester.number} ${recap.semester.academicYear}`;
  const used = new Set<string>();
  for (const cls of recap.classes) {
    const sheet = workbook.addWorksheet(sheetName(cls.name, used));
    sheet.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    cls.students.forEach((s, i) => sheet.addRow(columns.map((c) => c.value(s, i + 1))));
    columns.forEach((c, i) => {
      if (c.text) sheet.getColumn(i + 1).numFmt = '@';
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  if (recap.classes.length === 0) workbook.addWorksheet('Kosong').addRow(['Tidak ada siswa pada semester ini.']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
