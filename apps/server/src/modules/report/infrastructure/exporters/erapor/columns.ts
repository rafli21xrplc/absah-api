import type { SemesterRecapStudent } from '../../../domain/semester-recap';

/**
 * Columns of the e-Rapor ketidakhadiran sheet, one sheet per rombel, header in row 1.
 *
 * TODO(pilot): confirm with the pilot school's e-Rapor import template before release
 * (packages/db/fixtures/erapor/README.md). Not confirmed yet: header names, whether e-Rapor needs
 * its own row ids (peserta_didik_id / anggota_rombel_id from its template), and the sheet name.
 * Only the column order and values below are known to be what e-Rapor shows (S, I, Tanpa Keterangan).
 */
export const ERAPOR_COLUMNS: readonly { header: string; width: number; value: (s: SemesterRecapStudent, no: number) => string | number }[] = [
  { header: 'No', width: 5, value: (_s, no) => no },
  { header: 'NIS', width: 14, value: (s) => s.localId ?? '' },
  { header: 'NISN', width: 14, value: (s) => s.nisn ?? '' },
  { header: 'Nama Peserta Didik', width: 36, value: (s) => s.name },
  { header: 'Sakit', width: 8, value: (s) => s.counts.S },
  { header: 'Izin', width: 8, value: (s) => s.counts.I },
  { header: 'Tanpa Keterangan', width: 18, value: (s) => s.counts.A },
];
