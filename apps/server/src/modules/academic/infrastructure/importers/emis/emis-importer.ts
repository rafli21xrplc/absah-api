import { GUARDIAN_RELATIONS, type GuardianRelation } from '@absah/contracts';
import type ExcelJS from 'exceljs';
import { ImportFormatError, type ParsedImport, type StudentImporter } from '../../../domain/student-import';
import { cellText, headerKey } from '../cells';
import { column, firstSheet, readStudentRows, type Lookup, type StudentColumns } from '../student-sheet';

/**
 * Column names of the EMIS (Kemenag) student export, one header row under a few title rows.
 * TODO(pilot): built from public descriptions of EMIS 4.0, not from a real export. Check against a
 * partner madrasah's file (packages/db/fixtures/emis/README.md) before relying on it.
 */
const COLUMNS = {
  name: ['nama lengkap', 'nama siswa', 'nama peserta didik', 'nama'],
  nisn: ['nisn'],
  nik: ['nik', 'nik siswa'],
  localId: ['nis lokal', 'nis', 'nomor induk'],
  gender: ['jenis kelamin', 'jk', 'l/p'],
  birthPlace: ['tempat lahir'],
  birthDate: ['tanggal lahir', 'tgl lahir'],
  className: ['rombel', 'nama rombel', 'rombongan belajar', 'kelas'],
} as const;

const GUARDIAN_COLUMNS: Record<GuardianRelation, string[]> = {
  ayah: ['nama ayah', 'nama ayah kandung'],
  ibu: ['nama ibu', 'nama ibu kandung'],
  wali: ['nama wali'],
};

const MAX_HEADER_SCAN = 25;

function findHeader(sheet: ExcelJS.Worksheet): { lookup: Lookup; firstDataRow: number } {
  for (let r = 1; r <= Math.min(MAX_HEADER_SCAN, sheet.rowCount); r++) {
    const lookup: Lookup = new Map();
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const key = headerKey(cellText(cell.value));
      if (key && !lookup.has(key)) lookup.set(key, c);
    });
    if (column(lookup, COLUMNS.name) !== undefined && lookup.has('nisn')) return { lookup, firstDataRow: r + 1 };
  }
  throw new ImportFormatError('Kolom "Nama Lengkap" dan "NISN" tidak ditemukan. Pastikan berkas adalah ekspor data siswa dari EMIS.');
}

/** EMIS (madrasah) student export (.xlsx), the second StudentImporter (AKD-09). Same fields as Dapodik. */
export class EmisImporter implements StudentImporter {
  readonly source = 'emis' as const;

  async parse(file: Uint8Array): Promise<ParsedImport> {
    const sheet = await firstSheet(file, 'EMIS');
    const { lookup, firstDataRow } = findHeader(sheet);
    const cols = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, column(lookup, names)])) as StudentColumns;
    if (cols.className === undefined) throw new ImportFormatError('Kolom "Rombel" tidak ditemukan di berkas.');
    const guardianCols = GUARDIAN_RELATIONS.flatMap((relation) => {
      const c = column(lookup, GUARDIAN_COLUMNS[relation]);
      return c === undefined ? [] : [{ relation, c }];
    });
    return readStudentRows(sheet, firstDataRow, cols, guardianCols);
  }
}
