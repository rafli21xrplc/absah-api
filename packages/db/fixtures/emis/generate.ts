// Generates an anonymous EMIS (Kemenag) student export for tests and demos.
// TODO(pilot): the layout follows public descriptions of EMIS 4.0, not a real export (README.md).
// Every name, NISN and NIK is invented; NIKs use the non-existent region code 990101.
// Run: pnpm --filter @absah/db fixtures:emis
import ExcelJS from 'exceljs';
import path from 'node:path';

interface Student {
  nis: string;
  name: string;
  nisn: string | number | null;
  nik: string | null;
  jk: 'Laki-laki' | 'Perempuan';
  tempat: string;
  lahir: string;
  tingkat: string;
  rombel: string;
  ayah: string;
  ibu: string;
}

const students: Student[] = [
  { nis: '24001', name: 'AHMAD FAUZAN', nisn: '0081000001', nik: '9901010101080001', jk: 'Laki-laki', tempat: 'Cirebon', lahir: '01-01-2008', tingkat: 'X', rombel: 'X IPA 1', ayah: 'MUHAMMAD SOLEH', ibu: 'SITI KHODIJAH' },
  { nis: '24002', name: 'NUR AINI', nisn: '0081000002', nik: '9901014202080002', jk: 'Perempuan', tempat: 'Kuningan', lahir: '02-02-2008', tingkat: 'X', rombel: 'X IPA 1', ayah: 'ABDUL ROHMAN', ibu: 'FATIMAH' },
  { nis: '24003', name: 'RIZKI MAULANA', nisn: 81000003, nik: '9901010303080003', jk: 'Laki-laki', tempat: 'Majalengka', lahir: '03/03/2008', tingkat: 'X', rombel: 'X IPA 1', ayah: 'HASAN BASRI', ibu: 'AMINAH' },
  { nis: '24004', name: 'ZAHRA AULIA', nisn: '0081000004', nik: '9901014404080004', jk: 'Perempuan', tempat: 'Indramayu', lahir: '04-04-2008', tingkat: 'X', rombel: 'X IPS 1', ayah: 'YUSUF EFFENDI', ibu: 'MARYAM' },
  { nis: '24005', name: 'FARHAN HIDAYAT', nisn: null, nik: '9901010505080005', jk: 'Laki-laki', tempat: 'Cirebon', lahir: '05-05-2008', tingkat: 'X', rombel: 'X IPS 1', ayah: 'IBRAHIM', ibu: 'KHADIJAH' },
  { nis: '23001', name: 'SALSABILA PUTRI', nisn: '0071000006', nik: '9901014606070006', jk: 'Perempuan', tempat: 'Cirebon', lahir: '06-06-2007', tingkat: 'XI', rombel: 'XI IPA 1', ayah: 'ISMAIL MARZUKI', ibu: 'HALIMAH' },
];

const wb = new ExcelJS.Workbook();
wb.creator = 'Absah fixture';
wb.created = wb.modified = new Date(Date.UTC(2026, 6, 20));
const ws = wb.addWorksheet('Data Siswa');
ws.addRow(['DATA SISWA']);
ws.addRow(['MA CONTOH ABSAH']);
ws.addRow(['Tahun Pelajaran 2026/2027']);
ws.addRow([]);
ws.addRow(['No', 'NIS Lokal', 'NISN', 'NIK', 'Nama Lengkap', 'Jenis Kelamin', 'Tempat Lahir', 'Tanggal Lahir', 'Tingkat', 'Rombel', 'Nama Ayah', 'Nama Ibu', 'Nama Wali', 'Status']);
students.forEach((s, i) => ws.addRow([i + 1, s.nis, s.nisn, s.nik, s.name, s.jk, s.tempat, s.lahir, s.tingkat, s.rombel, s.ayah, s.ibu, '-', 'Aktif']));
await wb.xlsx.writeFile(path.join(import.meta.dirname, 'data-siswa.xlsx'));
process.stdout.write('emis fixture written\n');
