import type { TracerRecap, TracerStatus } from '@absah/contracts';
import ExcelJS from 'exceljs';
import type { AlumniRow } from './tracer-repo';

const STATUS_WORDS: Record<TracerStatus, string> = { bekerja: 'Bekerja', melanjutkan: 'Melanjutkan studi', wirausaha: 'Wirausaha', belum: 'Belum bekerja atau melanjutkan' };

/** Excel of the tracer study (PKL-05): the BMW recap per angkatan and jurusan, and the alumni with their answers. */
export async function tracerWorkbook(recap: TracerRecap, alumni: readonly AlumniRow[], streamLabel: (stream: string | null) => string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absah';
  workbook.title = 'Tracer study';

  const sheet = workbook.addWorksheet('Rekap BMW');
  sheet.columns = ['Angkatan', 'Jurusan', 'Alumni', 'Sudah mengisi', 'Bekerja', 'Melanjutkan', 'Wirausaha', 'Belum', 'BMW (%)'].map((header, i) => ({ header, width: i === 1 ? 16 : 14 }));
  sheet.getRow(1).font = { bold: true };
  for (const r of recap.rows) sheet.addRow([r.graduationYear, streamLabel(r.stream), r.total, r.answered, r.counts.bekerja, r.counts.melanjutkan, r.counts.wirausaha, r.counts.belum, r.bmwPercent ?? '']);
  const t = recap.totals;
  sheet.addRow(['Semua', '', t.total, t.answered, t.counts.bekerja, t.counts.melanjutkan, t.counts.wirausaha, t.counts.belum, t.bmwPercent ?? '']).font = { bold: true };
  sheet.addRow([]);
  sheet.addRow(['BMW (%) = bekerja + melanjutkan + wirausaha, dibagi alumni yang sudah mengisi.']);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const list = workbook.addWorksheet('Alumni');
  list.columns = ['Nama', 'NISN', 'Angkatan', 'Jurusan', 'Status', 'Perusahaan / kampus / usaha', 'Jabatan / prodi / bidang', 'Diisi oleh', 'Tanggal'].map((header, i) => ({ header, width: i === 0 ? 28 : i >= 5 && i <= 6 ? 30 : 16 }));
  list.getRow(1).font = { bold: true };
  for (const a of alumni) {
    list.addRow([a.name, a.nisn ?? '', a.graduationYear, streamLabel(a.stream), a.status ? STATUS_WORDS[a.status] : 'Belum mengisi', a.organization?.reveal() ?? '', a.position?.reveal() ?? '', a.source === 'alumni' ? 'Alumni' : a.source === 'bkk' ? 'BKK' : '', a.answeredAt ? a.answeredAt.toISOString().slice(0, 10) : '']);
  }
  list.getColumn(2).numFmt = '@';
  list.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
