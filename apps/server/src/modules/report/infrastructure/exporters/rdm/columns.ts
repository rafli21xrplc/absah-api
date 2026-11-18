import type { SheetColumn } from '../common/recap-workbook';

/**
 * Columns of the RDM (Rapor Digital Madrasah) ketidakhadiran sheet, one sheet per rombel.
 *
 * TODO(pilot): the order follows what RDM shows for ketidakhadiran (Sakit, Izin, Alpa), not a real
 * RDM import template. Check against the partner madrasah's sample (packages/db/fixtures/rdm/README.md)
 * before turning off the release flag rdm-export-beta.
 */
export const RDM_COLUMNS: readonly SheetColumn[] = [
  { header: 'No', width: 5, value: (_s, no) => no },
  { header: 'NIS', width: 14, text: true, value: (s) => s.localId ?? '' },
  { header: 'NISN', width: 14, text: true, value: (s) => s.nisn ?? '' },
  { header: 'Nama Siswa', width: 36, value: (s) => s.name },
  { header: 'Sakit', width: 8, value: (s) => s.counts.S },
  { header: 'Izin', width: 8, value: (s) => s.counts.I },
  { header: 'Alpa', width: 8, value: (s) => s.counts.A },
];
