import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { AssessmentTable } from '../domain/assessment-table';

export interface AssessmentFileInfo {
  schoolName: string;
  /** Printed date, "23-11-2026". */
  printedOn: string;
}

/** Excel of the results (PKL-04): header row, one row per placement, the mean at the bottom. Scores are numbers so the school can calculate on them. */
export async function assessmentWorkbook(table: AssessmentTable, info: AssessmentFileInfo): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absah';
  workbook.title = `Penilaian DUDI ${info.schoolName}`;
  const sheet = workbook.addWorksheet('Penilaian DUDI');
  const headers = ['No', 'Nama siswa', 'Rombel', 'DUDI', 'Periode', ...table.aspects, 'Nilai akhir', 'Catatan'];
  sheet.columns = headers.map((header, i) => ({ header, width: i === 1 ? 28 : i === 3 ? 26 : i === 4 ? 24 : i === headers.length - 1 ? 40 : i < 3 ? 12 : 14 }));
  sheet.getRow(1).font = { bold: true };
  for (const r of table.rows) sheet.addRow([r.no, r.student, r.className, r.partner, r.period, ...r.scores.map((s) => s ?? ''), r.overall ?? 'Belum dinilai', r.note ?? '']);
  const last = sheet.addRow(['', 'Rata-rata nilai akhir', '', '', '', ...table.aspects.map(() => ''), table.average ?? '', `${table.assessed} dari ${table.rows.length} siswa sudah dinilai`]);
  last.font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const MARGIN = 32;
const ROW = 18;

/** PDF of the results for the archive: landscape A4, header repeated on every page. The long note stays in the Excel. */
export function assessmentPdf(table: AssessmentTable, info: AssessmentFileInfo): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, info: { Title: 'Penilaian DUDI', Creator: 'Absah' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const usable = doc.page.width - MARGIN * 2;
  const fixed = [
    { title: 'No', width: 24 },
    { title: 'Nama siswa', width: 140 },
    { title: 'Rombel', width: 62 },
    { title: 'DUDI', width: 120 },
    { title: 'Periode', width: 110 },
  ];
  const tail = { title: 'Nilai akhir', width: 54 };
  const aspectWidth = Math.max(36, Math.min(70, (usable - fixed.reduce((n, c) => n + c.width, 0) - tail.width) / Math.max(1, table.aspects.length)));
  const columns = [...fixed, ...table.aspects.map((title) => ({ title, width: aspectWidth })), tail];
  const draw = (y: number, cells: readonly (string | number)[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let x = MARGIN;
    columns.forEach((c, i) => {
      doc.rect(x, y, c.width, ROW).stroke();
      doc.text(String(cells[i] ?? ''), x + 3, y + 5, { width: c.width - 6, height: ROW - 6, lineBreak: false, ellipsis: true, align: i >= 5 ? 'center' : 'left' });
      x += c.width;
    });
  };

  doc.font('Helvetica-Bold').fontSize(13).text('HASIL PENILAIAN DUDI (PKL)', MARGIN, MARGIN, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(`${info.schoolName} · dicetak ${info.printedOn}`, { align: 'center' });
  doc.moveDown(0.6);
  let y = doc.y;
  const header = columns.map((c) => c.title);
  const bottom = doc.page.height - MARGIN;
  draw(y, header, true);
  y += ROW;
  for (const r of table.rows) {
    if (y + ROW > bottom) {
      doc.addPage();
      y = MARGIN;
      draw(y, header, true);
      y += ROW;
    }
    draw(y, [r.no, r.student, r.className, r.partner, r.period, ...r.scores.map((s) => s ?? '-'), r.overall ?? 'Belum'], false);
    y += ROW;
  }
  if (table.rows.length === 0) doc.font('Helvetica').fontSize(10).text('Belum ada penempatan PKL.', MARGIN, y + 4);
  else doc.font('Helvetica').fontSize(8).text(`${table.assessed} dari ${table.rows.length} siswa sudah dinilai · rata-rata nilai akhir ${table.average ?? '-'}.`, MARGIN, y + 6);
  doc.end();
  return done;
}
