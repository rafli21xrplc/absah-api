import { DAY_NAMES } from '@absah/contracts';
import ExcelJS from 'exceljs';
import type { ScheduleRow } from '../../domain/schedule-import';
import { ImportFormatError } from '../../domain/student-import';
import { cellText, headerKey } from './cells';

/** The Absah schedule template: one row per lesson (long format), reference sheets beside it. */
export const SCHEDULE_SHEET = 'Jadwal';
const HEADERS = ['Rombel', 'Hari', 'Jam ke', 'Mapel', 'Guru'] as const;
const MAX_ROWS = 3000;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export interface ScheduleTemplateData {
  lessons: { className: string; day: number; period: number; subject: string; teacher: string | null }[];
  classes: string[];
  periods: { day: number; number: number; startsAt: string; endsAt: string }[];
  subjects: string[];
  teachers: string[];
}

function referenceSheet(workbook: ExcelJS.Workbook, name: string, header: string[], rows: (string | number)[][]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(header).font = { bold: true };
  for (const r of rows) sheet.addRow(r);
  sheet.columns.forEach((c) => (c.width = 22));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Template filled with the current rombel lessons, so a school can edit instead of retyping. */
export async function buildScheduleTemplate(data: ScheduleTemplateData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absah';
  const sheet = workbook.addWorksheet(SCHEDULE_SHEET);
  sheet.addRow([...HEADERS]).font = { bold: true };
  for (const l of data.lessons) sheet.addRow([l.className, DAY_NAMES[l.day] ?? String(l.day), l.period, l.subject, l.teacher ?? '']);
  sheet.columns.forEach((c, i) => (c.width = i === 2 ? 8 : 24));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const days = Object.values(DAY_NAMES).slice(0, 6);
  for (let r = 2; r <= Math.max(data.lessons.length + 200, 500); r++) {
    sheet.getCell(r, 2).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${days.join(',')}"`] };
    if (data.classes.length) {
      sheet.getCell(r, 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`Rombel!$A$2:$A$${data.classes.length + 1}`] };
    }
    if (data.teachers.length) {
      sheet.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: [`Guru!$A$2:$A$${data.teachers.length + 1}`] };
    }
  }

  referenceSheet(workbook, 'Rombel', ['Rombel'], data.classes.map((c) => [c]));
  referenceSheet(
    workbook,
    'Jam Pelajaran',
    ['Hari', 'Jam ke', 'Mulai', 'Selesai'],
    data.periods.map((p) => [DAY_NAMES[p.day] ?? '', p.number, p.startsAt, p.endsAt]),
  );
  referenceSheet(workbook, 'Mapel', ['Mapel'], data.subjects.map((s) => [s]));
  referenceSheet(workbook, 'Guru', ['Guru'], data.teachers.map((t) => [t]));
  referenceSheet(workbook, 'Petunjuk', ['Petunjuk'], [
    ['Satu baris = satu pelajaran. Hari: Senin sampai Sabtu. Jam ke: nomor jam pelajaran (lihat lembar Jam Pelajaran).'],
    ['Rombel yang tercantum di berkas diganti seluruh jadwalnya; rombel yang tidak tercantum tidak berubah.'],
    ['Mapel baru dibuat otomatis. Guru harus staf aktif sekolah (lihat lembar Guru); kolom Guru boleh kosong.'],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Rows of the Jadwal sheet; blank rows are skipped. Row numbers are Excel row numbers. */
export async function readScheduleTemplate(file: Buffer): Promise<ScheduleRow[]> {
  if (!ZIP_MAGIC.every((b, i) => file[i] === b)) throw new ImportFormatError('Berkas bukan .xlsx. Gunakan template jadwal dari Absah.');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new ImportFormatError('Berkas .xlsx tidak bisa dibaca.');
  }
  const sheet = workbook.getWorksheet(SCHEDULE_SHEET) ?? workbook.worksheets[0];
  if (!sheet) throw new ImportFormatError('Berkas tidak berisi lembar kerja.');
  const header = HEADERS.map((_, i) => headerKey(cellText(sheet.getRow(1).getCell(i + 1).value)));
  if (header.join('|') !== HEADERS.map(headerKey).join('|')) {
    throw new ImportFormatError(`Baris pertama lembar "${SCHEDULE_SHEET}" harus berisi kolom: ${HEADERS.join(', ')}. Unduh ulang template dari Absah.`);
  }
  if (sheet.rowCount > MAX_ROWS + 1) throw new ImportFormatError(`Berkas berisi lebih dari ${MAX_ROWS} baris.`);

  const rows: ScheduleRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const cells = HEADERS.map((_, i) => cellText(sheet.getRow(r).getCell(i + 1).value).trim());
    if (cells.every((c) => c === '')) continue;
    const [className = '', day = '', period = '', subject = '', teacher = ''] = cells;
    rows.push({ row: r, className, day, period, subject, teacher });
  }
  return rows;
}
