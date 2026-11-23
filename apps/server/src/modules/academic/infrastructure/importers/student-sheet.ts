import type { GuardianRelation } from '@absah/contracts';
import ExcelJS from 'exceljs';
import { cleanText, ImportFormatError, type ImportedStudent, type ImportIssue, type ParsedImport } from '../../domain/student-import';
import { cellText, dateValue, identifier } from './cells';

/** Student list exports (Dapodik, EMIS) read the same fields; only the header layout differs. */
export const MAX_ROWS = 5000;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export type Lookup = Map<string, number>;
export const column = (lookup: Lookup, names: readonly string[]) => names.map((n) => lookup.get(n)).find((c) => c !== undefined);

export interface StudentColumns {
  name?: number;
  nisn?: number;
  nik?: number;
  localId?: number;
  gender?: number;
  birthPlace?: number;
  birthDate?: number;
  className?: number;
}

/** The first worksheet of an .xlsx; `system` names the source in messages for staff. */
export async function firstSheet(file: Uint8Array, system: string): Promise<ExcelJS.Worksheet> {
  if (!ZIP_MAGIC.every((b, i) => file[i] === b)) {
    throw new ImportFormatError('Berkas bukan .xlsx. Bila berkas berformat .xls, buka di Excel lalu simpan ulang sebagai .xlsx.');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new ImportFormatError(`Berkas .xlsx tidak bisa dibaca. Unduh ulang dari ${system}.`);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportFormatError('Berkas tidak berisi lembar kerja.');
  return sheet;
}

/** Rows from firstDataRow on: empty rows skipped, unreadable fields become warnings, no name = error. */
export function readStudentRows(sheet: ExcelJS.Worksheet, firstDataRow: number, cols: StudentColumns, guardianCols: { relation: GuardianRelation; c: number }[]): ParsedImport {
  if (sheet.rowCount - firstDataRow + 1 > MAX_ROWS) throw new ImportFormatError(`Berkas berisi lebih dari ${MAX_ROWS} baris.`);
  const rows: ImportedStudent[] = [];
  const issues: ImportIssue[] = [];
  for (let r = firstDataRow; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const raw = (c: number | undefined) => (c === undefined ? null : row.getCell(c).value);
    const text = (c: number | undefined) => cleanText(cellText(raw(c)));
    const name = text(cols.name);
    const nisn = identifier(raw(cols.nisn), 10);
    const nik = identifier(raw(cols.nik), 16);
    if (!name && !nisn.value && !nik.value) continue; // empty or footer row

    const warn = (field: string, message: string) => issues.push({ row: r, field, message, severity: 'warning' });
    if (!name) {
      issues.push({ row: r, field: 'name', message: 'Nama kosong; baris dilewati.', severity: 'error' });
      continue;
    }
    if (nisn.problem) warn('nisn', `NISN ${nisn.problem}.`);
    if (nik.problem) warn('nik', `NIK ${nik.problem}.`);

    const genderText = text(cols.gender).toUpperCase();
    const gender = genderText.startsWith('L') ? 'L' : genderText.startsWith('P') ? 'P' : null;
    if (genderText && !gender) warn('gender', 'Jenis kelamin tidak dikenali.');

    const birthRaw = raw(cols.birthDate);
    const birthDate = dateValue(birthRaw);
    if (cellText(birthRaw).trim() && !birthDate) warn('birthDate', 'Tanggal lahir tidak dikenali.');

    const className = text(cols.className) || null;
    if (!className) warn('className', 'Rombel kosong; siswa tidak dimasukkan ke rombel.');

    rows.push({
      row: r,
      name,
      nisn: nisn.value,
      nik: nik.value,
      localId: text(cols.localId) || null,
      gender,
      birthPlace: text(cols.birthPlace) || null,
      birthDate,
      className,
      guardians: guardianCols.flatMap(({ relation, c }) => {
        const guardianName = text(c);
        return guardianName && guardianName !== '-' ? [{ relation, name: guardianName }] : [];
      }),
    });
  }
  if (rows.length === 0) throw new ImportFormatError('Tidak ada data siswa di berkas.');
  return { rows, issues };
}
