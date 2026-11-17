import { GUARDIAN_RELATIONS, type GuardianRelation } from '@absah/contracts';
import type ExcelJS from 'exceljs';
import { ImportFormatError, type ParsedImport, type StudentImporter } from '../../../domain/student-import';
import { cellText, headerKey } from '../cells';
import { column, firstSheet, readStudentRows, type Lookup, type StudentColumns } from '../student-sheet';

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

/** Dapodik "Daftar Peserta Didik" (.xlsx) importer. Reads only the columns Absah needs. */
export class DapodikImporter implements StudentImporter {
  readonly source = 'dapodik' as const;

  async parse(file: Uint8Array): Promise<ParsedImport> {
    const sheet = await firstSheet(file, 'Dapodik');
    const { lookup, firstDataRow } = findHeader(sheet);
    const cols = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, column(lookup, names)])) as StudentColumns;
    if (cols.className === undefined) throw new ImportFormatError('Kolom "Rombel Saat Ini" tidak ditemukan di berkas.');
    const guardianCols = GUARDIAN_RELATIONS.flatMap((relation) => {
      const c = column(lookup, GUARDIAN_COLUMNS[relation]);
      return c === undefined ? [] : [{ relation, c }];
    });
    return readStudentRows(sheet, firstDataRow, cols, guardianCols);
  }
}
