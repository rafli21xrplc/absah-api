import PDFDocument from 'pdfkit';
import type { SemesterRecap, SemesterRecapClass } from '../../../domain/semester-recap';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** "2027-06-19" -> "19 Juni 2027". */
export function tanggal(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d ?? ''} ${MONTHS[(m ?? 1) - 1] ?? ''} ${y ?? ''}`;
}

const MARGIN = 40;
const ROW = 16;
/** No, NISN, Nama, H, T, S, I, A (Tanpa Keterangan). */
const COLUMNS = [
  { title: 'No', width: 28, align: 'center' },
  { title: 'NISN', width: 78, align: 'left' },
  { title: 'Nama Peserta Didik', width: 219, align: 'left' },
  { title: 'H', width: 36, align: 'center' },
  { title: 'T', width: 36, align: 'center' },
  { title: 'S', width: 36, align: 'center' },
  { title: 'I', width: 36, align: 'center' },
  { title: 'A', width: 46, align: 'center' },
] as const;

type Doc = InstanceType<typeof PDFDocument>;

function row(doc: Doc, y: number, cells: readonly (string | number)[], bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
  let x = MARGIN;
  COLUMNS.forEach((c, i) => {
    doc.rect(x, y, c.width, ROW).stroke();
    doc.text(String(cells[i] ?? ''), x + 3, y + 4, { width: c.width - 6, align: c.align, lineBreak: false, ellipsis: true });
    x += c.width;
  });
}

function heading(doc: Doc, recap: SemesterRecap, cls: SemesterRecapClass) {
  const s = recap.semester;
  doc.font('Helvetica-Bold').fontSize(12).text('REKAP KEHADIRAN PESERTA DIDIK', MARGIN, MARGIN, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(recap.school.name + (recap.school.npsn ? ` (NPSN ${recap.school.npsn})` : ''), { align: 'center' });
  doc.text(`Semester ${s.number} Tahun Ajaran ${s.academicYear} (${tanggal(s.startsOn)} - ${tanggal(s.endsOn)})`, { align: 'center' });
  doc.moveDown(0.8).text(`Rombel: ${cls.name}`, MARGIN).text(`Wali kelas: ${cls.homeroomName ?? '-'}`);
  doc.moveDown(0.5);
  return doc.y;
}

/** Words that differ between schools and madrasah. */
export interface PdfLabels {
  principal: string;
}

function signatures(doc: Doc, recap: SemesterRecap, cls: SemesterRecapClass, top: number, labels: PdfLabels) {
  const width = 200;
  const right = doc.page.width - MARGIN - width;
  doc.font('Helvetica').fontSize(10);
  doc.text('Mengetahui,', MARGIN, top, { width }).text(labels.principal, { width });
  doc.text(tanggal(recap.signedOn), right, top, { width }).text('Wali Kelas', right, undefined, { width });
  const nameY = top + 80;
  doc.font('Helvetica-Bold');
  doc.text(recap.principalName ?? '(.................................)', MARGIN, nameY, { width, underline: Boolean(recap.principalName) });
  doc.text(cls.homeroomName ?? '(.................................)', right, nameY, { width, underline: Boolean(cls.homeroomName) });
}

/**
 * Archive copy (RKP-02, RKP-07): one section per rombel with H/T/S/I/A per student and signature
 * blocks for the kepala sekolah/madrasah and wali kelas, signed on paper after printing.
 */
export function recapPdf(recap: SemesterRecap, labels: PdfLabels): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: 'Rekap kehadiran', Creator: 'Absah' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const bottom = () => doc.page.height - MARGIN;
  const header = COLUMNS.map((c) => c.title);

  if (recap.classes.length === 0) doc.font('Helvetica').fontSize(11).text('Tidak ada siswa pada semester ini.');
  recap.classes.forEach((cls, index) => {
    if (index > 0) doc.addPage();
    let y = heading(doc, recap, cls);
    row(doc, y, header, true);
    y += ROW;
    cls.students.forEach((s, i) => {
      if (y + ROW > bottom()) {
        doc.addPage();
        y = MARGIN;
        row(doc, y, header, true);
        y += ROW;
      }
      row(doc, y, [i + 1, s.nisn ?? '', s.name, s.counts.H, s.counts.T, s.counts.S, s.counts.I, s.counts.A]);
      y += ROW;
    });
    doc.font('Helvetica').fontSize(8).text('H hadir, T terlambat, S sakit, I izin, A tanpa keterangan (dalam hari sekolah).', MARGIN, y + 4);
    if (y + 140 > bottom()) {
      doc.addPage();
      y = MARGIN;
    }
    signatures(doc, recap, cls, y + 24, labels);
  });
  doc.end();
  return done;
}
