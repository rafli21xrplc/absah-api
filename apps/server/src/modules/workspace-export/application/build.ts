import { decrypt } from '@absah/db';
import { withTenant } from '../../../shared/db';
import type { ObjectStorage } from '../../../shared/storage';
import { csvLine, CSV_BOM } from '../domain/csv';
import { encryptionContext, fileEntryName, isExportedTable, looksEncrypted, MAX_FILE_BYTES_TOTAL, omitColumn, STORAGE_COLUMNS, tableEntryName } from '../domain/tables';
import { columnsOf, rowsOf, storageKeysOf, tenantTables } from '../infrastructure/introspect';
import { ZipBuilder } from '../infrastructure/zip';

export interface WorkspaceZip {
  zip: Buffer;
  tables: number;
  files: number;
  rows: number;
  /** Encrypted cells that could not be decrypted (written as a marker, counted in README.txt). */
  undecryptable: number;
  skippedFiles: number;
}

export const UNDECRYPTABLE = '[gagal didekripsi]';

/**
 * Builds the workspace archive: one CSV per table (header row, UTF-8 with BOM, encrypted cells decrypted, hash/secret columns
 * left out), the school's uploaded files, a list of those files and a README. It reads inside ONE tenant transaction as the
 * person who asked, so row-level security shows exactly what that person may read (counseling notes by role, the tppk schema
 * only for team members), and the whole archive is a consistent snapshot of one moment.
 */
export async function buildWorkspaceZip(input: { schoolId: string; requestedBy: string | null; includeFiles: boolean; includeTppk: boolean; storage: ObjectStorage; now?: Date }): Promise<WorkspaceZip> {
  const zip = new ZipBuilder();
  const now = input.now ?? new Date();
  let tables = 0;
  let rows = 0;
  let undecryptable = 0;
  let skippedFiles = 0;
  const fileList: string[][] = [];
  const fileBuffers: { name: string; data: Buffer }[] = [];

  await withTenant({ schoolId: input.schoolId, userId: input.requestedBy }, async (tx) => {
    // The tppk schema is read only when it was agreed at request time AND there is a requester to apply RLS for.
    const includeTppk = input.includeTppk && input.requestedBy !== null;
    for (const ref of await tenantTables(tx)) {
      if (!isExportedTable(ref.schema, ref.table, includeTppk)) continue;
      const columns = (await columnsOf(tx, ref)).filter((c) => !omitColumn(c));
      let csv = CSV_BOM + csvLine(columns);
      let count = 0;
      for await (const batch of rowsOf(tx, ref, columns)) {
        for (const row of batch) {
          csv += csvLine(
            columns.map((c) => {
              const value = row[c];
              if (!looksEncrypted(value)) return value;
              try {
                return decrypt(value, encryptionContext(ref.schema, ref.table, c));
              } catch {
                undecryptable += 1;
                return UNDECRYPTABLE;
              }
            }),
          );
        }
        count += batch.length;
      }
      zip.add(tableEntryName(ref.schema, ref.table), Buffer.from(csv, 'utf8'), now);
      tables += 1;
      rows += count;
    }

    if (input.includeFiles) {
      let bytes = 0;
      for (const { table, column } of STORAGE_COLUMNS) {
        for (const { id, key } of await storageKeysOf(tx, table, column)) {
          const entry = fileEntryName(key);
          const data = bytes < MAX_FILE_BYTES_TOTAL ? await input.storage.read(key) : null;
          if (data === null) {
            skippedFiles += 1;
            fileList.push([table, column, id, '', bytes >= MAX_FILE_BYTES_TOTAL ? 'dilewati: terlalu besar' : 'tidak ditemukan di penyimpanan']);
            continue;
          }
          bytes += data.length;
          fileBuffers.push({ name: entry, data });
          fileList.push([table, column, id, entry, 'ada']);
        }
      }
    }
  });

  for (const f of fileBuffers) zip.add(f.name, f.data, now);
  if (input.includeFiles) zip.add('berkas/_daftar.csv', Buffer.from(CSV_BOM + csvLine(['tabel', 'kolom', 'id_baris', 'berkas', 'keterangan']) + fileList.map((l) => csvLine(l)).join(''), 'utf8'), now);
  zip.add('README.txt', Buffer.from(readme({ now, tables, rows, files: fileBuffers.length, skippedFiles, undecryptable, includeFiles: input.includeFiles, includeTppk: input.includeTppk && input.requestedBy !== null }), 'utf8'), now);
  return { zip: zip.finish(), tables, files: fileBuffers.length, rows, undecryptable, skippedFiles };
}

function readme(r: { now: Date; tables: number; rows: number; files: number; skippedFiles: number; undecryptable: number; includeFiles: boolean; includeTppk: boolean }): string {
  return [
    'Ekspor data sekolah (Absah)',
    `Dibuat: ${r.now.toISOString()}`,
    '',
    `Isi: ${r.tables} tabel (folder tabel/, satu berkas CSV per tabel, UTF-8, baris pertama nama kolom), ${r.rows} baris.`,
    r.includeFiles ? `Berkas unggahan: ${r.files} berkas di folder berkas/ (daftar dan asal baris di berkas/_daftar.csv)${r.skippedFiles ? `; ${r.skippedFiles} tidak ikut (lihat keterangan di daftar)` : ''}.` : 'Berkas unggahan tidak diminta.',
    '',
    'Catatan:',
    '- Kolom yang dienkripsi di Absah (nomor telepon, catatan, dan sejenisnya) ditulis apa adanya setelah didekripsi.',
    '- Kolom hash dan rahasia (indeks pencarian, hash IP, kunci) tidak ikut.',
    '- Data dibaca dengan hak orang yang memintanya: catatan BK mengikuti hak baca peran itu.',
    r.includeTppk ? '- Skema TPPK (tabel/tppk/) ikut karena peminta adalah anggota tim TPPK.' : '- Skema TPPK tidak ikut: hanya anggota tim TPPK yang boleh membacanya dan memintanya.',
    r.undecryptable ? `- ${r.undecryptable} sel terenkripsi tidak bisa didekripsi dan ditulis sebagai "${UNDECRYPTABLE}".` : '',
    '- Tabel yang berisi rahasia sistem (kunci, antrean, undangan) tidak ikut.',
    '',
  ].join('\r\n');
}
