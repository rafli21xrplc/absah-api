import type { JournalEntry } from '@absah/contracts';
import ExcelJS from 'exceljs';

const STATUS_LABEL: Record<JournalEntry['status'], string> = { open: 'Belum diisi', submitted: 'Sudah diisi', locked: 'Terkunci', missed: 'Tidak diisi' };

/** One teacher, one month: a row per lesson with its topic (PRS-09). */
export async function journalWorkbook(input: { teacherName: string; month: string; entries: JournalEntry[] }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absah';
  workbook.title = `Jurnal mengajar ${input.teacherName} ${input.month}`;
  const sheet = workbook.addWorksheet(input.month);
  sheet.addRow([`Jurnal mengajar: ${input.teacherName}`]).font = { bold: true, size: 13 };
  sheet.addRow([`Bulan ${input.month}`]);
  sheet.addRow([]);
  const header = sheet.addRow(['No', 'Tanggal', 'Jam ke', 'Waktu', 'Rombel', 'Mata pelajaran', 'Topik', 'Status']);
  header.font = { bold: true };
  const widths = [5, 12, 8, 13, 16, 24, 60, 14];
  widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  input.entries.forEach((e, i) =>
    sheet.addRow([
      i + 1,
      e.schoolDate,
      e.period?.number ?? '',
      e.period ? `${e.period.startsAt}-${e.period.endsAt}` : '',
      e.className,
      e.subject?.name ?? '',
      e.topic ?? '',
      STATUS_LABEL[e.status],
    ]),
  );
  if (input.entries.length === 0) sheet.addRow(['', 'Tidak ada sesi pada bulan ini.']);
  sheet.getColumn(7).alignment = { wrapText: true, vertical: 'top' };
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
