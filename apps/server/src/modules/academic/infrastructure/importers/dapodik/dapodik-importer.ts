import { GUARDIAN_RELATIONS, type GuardianRelation } from '@absah/contracts';
import ExcelJS from 'exceljs';
import {
  cleanText,
  ImportFormatError,
  type ImportedStudent,
  type ImportIssue,
  type ParsedImport,
  type StudentImporter,
} from '../../../domain/student-import';
import { cellText, dateValue, headerKey, identifier } from '../cells';

/**
 * Column names in the Dapodik "Daftar Peserta Didik" export. Parent columns sit under merged
 * group headers ("Data Ayah" / "Nama"); older exports use flat names ("Nama Ayah").
 */
const COLUMNS = {
  name: ['nama', 'nama peserta didik'],
  nisn: ['nisn'],
  nik: ['nik'],
  localId: ['nipd', 'nis'],
  gender: ['jk', 'jenis kelamin', 'l/p'],
  birthPlace: ['tempat lahir'],
  birthDate: ['tanggal lahir'],
  className: ['rombel saat ini', 'rombel', 'kelas'],
} as const;

const GUARDIAN_COLUMNS: Record<GuardianRelation, string[]> = {
  ayah: ['data ayah/nama', 'nama ayah', 'nama ayah kandung'],
  ibu: ['data ibu/nama', 'nama ibu', 'nama ibu kandung'],
  wali: ['data wali/nama', 'nama wali'],
};

const MAX_HEADER_SCAN = 25;
const MAX_ROWS = 5000;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

type Lookup = Map<string, number>;

function findHeader(sheet: ExcelJS.Worksheet): { lookup: Lookup; firstDataRow: number } {
  for (let r = 1; r <= Math.min(MAX_HEADER_SCAN, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const tops = new Map<number, string>();
    row.eachCell({ includeEmpty: false }, (cell, c) => tops.set(c, headerKey(cellText(cell.value))));
    const values = [...tops.values()];
    if (!values.includes('nama') || !(values.includes('nisn') || values.includes('nik'))) continue;

    // A second header row holds the sub-columns of merged groups (Data Ayah -> Nama, NIK, ...).
    const sub = sheet.getRow(r + 1);
    const subs = new Map<number, string>();
    sub.eachCell({ includeEmpty: false }, (cell, c) => {
      if (!cell.isMerged || cell.master.address === cell.address) subs.set(c, headerKey(cellText(cell.value)));
    });
    const hasSubHeader = [...subs.values()].some((v) => v === 'nama');

    const lookup: Lookup = new Map();
    for (let c = 1; c <= sheet.columnCount; c++) {
      const top = headerKey(cellText(row.getCell(c).value));
      const below = hasSubHeader ? subs.get(c) : undefined;
      const name = below && below !== top ? `${top}/${below}` : top;
      if (name && !lookup.has(name)) lookup.set(name, c);
    }
    return { lookup, firstDataRow: r + (hasSubHeader ? 2 : 1) };
  }
  throw new ImportFormatError('Kolom "Nama" dan "NISN" tidak ditemukan. Pastikan berkas adalah ekspor Daftar Peserta Didik dari Dapodik.');
}

const column = (lookup: Lookup, names: readonly string[]) => names.map((n) => lookup.get(n)).find((c) => c !== undefined);

/** Dapodik "Daftar Peserta Didik" (.xlsx) importer. Reads only the columns Absah needs. */
export class DapodikImporter implements StudentImporter {
  readonly source = 'dapodik' as const;

  async parse(file: Uint8Array): Promise<ParsedImport> {
    if (!ZIP_MAGIC.every((b, i) => file[i] === b)) {
      throw new ImportFormatError('Berkas bukan .xlsx. Bila berkas berformat .xls, buka di Excel lalu simpan ulang sebagai .xlsx.');
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new ImportFormatError('Berkas .xlsx tidak bisa dibaca. Unduh ulang dari Dapodik.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ImportFormatError('Berkas tidak berisi lembar kerja.');

    const { lookup, firstDataRow } = findHeader(sheet);
    const cols = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, column(lookup, names)])) as Record<keyof typeof COLUMNS, number | undefined>;
    if (cols.className === undefined) throw new ImportFormatError('Kolom "Rombel Saat Ini" tidak ditemukan di berkas.');
    const guardianCols = GUARDIAN_RELATIONS.flatMap((relation) => {
      const c = column(lookup, GUARDIAN_COLUMNS[relation]);
      return c === undefined ? [] : [{ relation, c }];
    });

    const rows: ImportedStudent[] = [];
    const issues: ImportIssue[] = [];
    if (sheet.rowCount - firstDataRow + 1 > MAX_ROWS) throw new ImportFormatError(`Berkas berisi lebih dari ${MAX_ROWS} baris.`);

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
}
