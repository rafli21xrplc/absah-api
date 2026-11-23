import PDFDocument from 'pdfkit';
import { HABIT_LABELS, habitPredicate, habitRate, type CharacterReport, type CharacterStudent } from '../../../domain/character-report';
import { tanggal } from './recap-pdf';

const MARGIN = 40;
const ROW = 18;

type Doc = InstanceType<typeof PDFDocument>;

const percent = (rate: number | null) => (rate === null ? '-' : `${Math.round(rate * 100)}%`);

function section(doc: Doc, title: string) {
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text(title, MARGIN);
  doc.moveTo(MARGIN, doc.y + 1).lineTo(doc.page.width - MARGIN, doc.y + 1).stroke();
  doc.moveDown(0.4);
}

function table(doc: Doc, widths: readonly number[], rows: readonly (readonly (string | number)[])[], header: readonly string[]) {
  const draw = (cells: readonly (string | number)[], bold: boolean) => {
    const y = doc.y;
    let x = MARGIN;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    widths.forEach((w, i) => {
      doc.rect(x, y, w, ROW).stroke();
      doc.text(String(cells[i] ?? ''), x + 4, y + 5, { width: w - 8, lineBreak: false, ellipsis: true, align: i === 0 ? 'left' : 'center' });
      x += w;
    });
    doc.y = y + ROW;
  };
  draw(header, true);
  for (const r of rows) draw(r, false);
}

function page(doc: Doc, report: CharacterReport, s: CharacterStudent) {
  const sem = report.semester;
  doc.font('Helvetica-Bold').fontSize(13).text('RAPOR KARAKTER PESERTA DIDIK', MARGIN, MARGIN, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(report.school.name + (report.school.npsn ? ` (NPSN ${report.school.npsn})` : ''), { align: 'center' });
  doc.text(`Semester ${sem.number} Tahun Ajaran ${sem.academicYear} (${tanggal(sem.startsOn)} - ${tanggal(sem.endsOn)})`, { align: 'center' });
  doc.moveDown(0.8).font('Helvetica-Bold').text(`Nama: ${s.name}`, MARGIN).font('Helvetica').text(`NISN: ${s.nisn ?? '-'}`).text(`Rombel: ${report.className}`);

  section(doc, 'Kehadiran');
  const c = s.counts;
  table(doc, [100, 70, 70, 70, 70, 135], [[`${c.H + c.T} hari`, c.H, c.T, c.S, c.I, c.A]], ['Hadir (H+T)', 'H', 'T', 'S', 'I', 'A (tanpa keterangan)']);
  doc.moveDown(0.3).font('Helvetica').fontSize(9).text(`Kehadiran ${percent(s.presentRate)} dari ${c.H + c.T + c.S + c.I + c.A} hari sekolah.`, MARGIN);

  section(doc, 'Poin kesiswaan');
  table(doc, [257, 258], [[s.achievementPoints, s.violationPoints]], ['Prestasi', 'Pelanggaran']);

  section(doc, 'Kebiasaan (7 Kebiasaan Anak Indonesia Hebat, termasuk ibadah)');
  table(
    doc,
    [215, 100, 100, 100],
    s.habits.map((h) => [HABIT_LABELS[h.habit], `${h.yes} dari ${h.filled}`, percent(habitRate(h)), habitPredicate(habitRate(h))]),
    ['Kebiasaan', 'Hari dilakukan', 'Persen', 'Predikat'],
  );

  section(doc, 'Kegiatan');
  if (s.activities.length === 0) doc.font('Helvetica').fontSize(9).text('Tidak mengikuti kegiatan.', MARGIN);
  else table(doc, [255, 130, 130], s.activities.map((a) => [a.name, a.kind, `${a.present} dari ${a.recorded} pertemuan`]), ['Kegiatan', 'Jenis', 'Kehadiran']);

  const top = Math.max(doc.y + 24, doc.page.height - MARGIN - 150);
  const width = 200;
  const right = doc.page.width - MARGIN - width;
  doc.font('Helvetica').fontSize(10);
  doc.text('Mengetahui,', MARGIN, top, { width }).text(report.principalTitle, { width });
  doc.text(tanggal(report.signedOn), right, top, { width }).text('Wali Kelas', right, undefined, { width });
  doc.font('Helvetica-Bold');
  doc.text(report.principalName ?? '(.................................)', MARGIN, top + 80, { width, underline: Boolean(report.principalName) });
  doc.text(report.homeroomName ?? '(.................................)', right, top + 80, { width, underline: Boolean(report.homeroomName) });
}

/** Semester character report (KEG-04): one A4 page per student, signed on paper by the wali kelas and kepala sekolah. */
export function characterPdf(report: CharacterReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: 'Rapor karakter', Creator: 'Absah' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  if (report.students.length === 0) doc.font('Helvetica').fontSize(11).text('Tidak ada siswa pada rombel ini di semester ini.');
  report.students.forEach((s, i) => {
    if (i > 0) doc.addPage();
    page(doc, report, s);
  });
  doc.end();
  return done;
}
