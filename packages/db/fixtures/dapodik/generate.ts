// Generates anonymous Dapodik "Daftar Peserta Didik" exports for tests and demos.
// Every name, NISN and NIK here is invented; NIKs use the non-existent region code 990101.
// Run: pnpm --filter @absah/db fixtures:dapodik
import ExcelJS from 'exceljs';
import path from 'node:path';

interface Student {
  name: string;
  nipd: string;
  jk: 'L' | 'P';
  nisn: string | number | null;
  tempat: string;
  lahir: string | Date;
  nik: string | null;
  rombel: string;
  ayah: string;
  ibu: string;
  wali?: string;
}

const PARENT_SUB = ['Nama', 'Tahun Lahir', 'Jenjang Pendidikan', 'Pekerjaan', 'Penghasilan', 'NIK'];
const BEFORE = ['No', 'Nama', 'NIPD', 'JK', 'NISN', 'Tempat Lahir', 'Tanggal Lahir', 'NIK', 'Agama', 'Alamat', 'RT', 'RW', 'Kelurahan', 'Kecamatan', 'Kode Pos', 'HP'];
const AFTER = ['Rombel Saat Ini', 'No Peserta Ujian Nasional', 'Sekolah Asal', 'Anak ke-berapa'];

const base: Student[] = [
  { name: 'ADITYA PRATAMA', nipd: '2601', jk: 'L', nisn: '0131000001', tempat: 'Bandung', lahir: '2013-02-11', nik: '9901010211130001', rombel: 'VII A', ayah: 'BAMBANG SURYADI', ibu: 'SITI AMINAH' },
  { name: 'BUNGA LESTARI', nipd: '2602', jk: 'P', nisn: '0131000002', tempat: 'Bogor', lahir: '2013-04-23', nik: '9901016304130002', rombel: 'VII A', ayah: 'HENDRA WIJAYA', ibu: 'RINA MARLINA' },
  // NISN typed as a number in Excel: the leading zero is gone.
  { name: 'CANDRA KIRANA', nipd: '2603', jk: 'P', nisn: 131000003, tempat: 'Garut', lahir: '14/06/2013', nik: '9901015406130003', rombel: 'VII A', ayah: 'DEDI KURNIAWAN', ibu: 'YULI ASTUTI' },
  { name: 'DIMAS ANGGARA', nipd: '2604', jk: 'L', nisn: '0131000004', tempat: 'Cianjur', lahir: new Date(Date.UTC(2013, 0, 30)), nik: '9901013001130004', rombel: 'VII A', ayah: 'AGUS SALIM', ibu: 'NUR HAYATI' },
  { name: 'EKA PUTRI RAHAYU', nipd: '2605', jk: 'P', nisn: '0131000005', tempat: 'Sumedang', lahir: '2013-08-09', nik: '9901014908130005', rombel: 'VII B', ayah: 'JOKO SANTOSO', ibu: 'DEWI SARTIKA' },
  { name: 'FAJAR NUGROHO', nipd: '2606', jk: 'L', nisn: '0131000006', tempat: 'Bandung', lahir: '2012-12-01', nik: '9901010112120006', rombel: 'VII B', ayah: 'RUDI HARTONO', ibu: 'ENDANG SRI', wali: 'SUPARMAN' },
  // No NISN yet (new student): matched later by NIK.
  { name: 'GITA SAFITRI', nipd: '2607', jk: 'P', nisn: null, tempat: 'Subang', lahir: '2013-10-17', nik: '9901015710130007', rombel: 'VII B', ayah: 'TONI SUHENDAR', ibu: 'LILIS KARLINA' },
  { name: 'HADI SAPUTRA', nipd: '2608', jk: 'L', nisn: '0121000008', tempat: 'Bandung', lahir: '2012-03-05', nik: '9901010503120008', rombel: 'VIII A', ayah: 'WAWAN SETIAWAN', ibu: 'IIS ROHAENI' },
  { name: 'INDAH PERMATA', nipd: '2609', jk: 'P', nisn: '0121000009', tempat: 'Tasikmalaya', lahir: '2012-07-21', nik: '9901016107120009', rombel: 'VIII A', ayah: 'ASEP SUNANDAR', ibu: 'NENG SITI' },
  // No NISN, no NIK: only name + birth date can match it.
  { name: 'JAJANG MULYANA', nipd: '2610', jk: 'L', nisn: null, tempat: 'Bandung', lahir: '2012-09-02', nik: null, rombel: 'VIII A', ayah: 'UJANG KOSASIH', ibu: 'EUIS KOMALA' },
];

/** The next export a few weeks later. */
const later: Student[] = base
  .filter((s) => s.name !== 'BUNGA LESTARI') // moved away: calon keluar
  .map((s) => {
    if (s.name === 'DIMAS ANGGARA') return { ...s, rombel: 'VII B' }; // class moved
    if (s.name === 'EKA PUTRI RAHAYU') return { ...s, name: 'EKA PUTRI RAHAYU NINGSIH' }; // name corrected
    if (s.name === 'GITA SAFITRI') return { ...s, nisn: '0131000007' }; // NISN issued
    return s;
  })
  .concat([{ name: 'KARINA OKTAVIA', nipd: '2611', jk: 'P', nisn: '0131000011', tempat: 'Bandung', lahir: '2013-10-05', nik: '9901014510130011', rombel: 'VII A', ayah: 'YAYAN SOPYAN', ibu: 'ATIK SUMIATI' }]);

async function write(file: string, students: Student[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Absah fixture';
  wb.created = wb.modified = new Date(Date.UTC(2026, 6, 20));
  const ws = wb.addWorksheet('Daftar Peserta Didik');
  ws.addRow(['Daftar Peserta Didik']);
  ws.addRow(['SMP NEGERI CONTOH ABSAH']);
  ws.addRow(['Kecamatan Contoh, Kabupaten Contoh, Provinsi Contoh']);
  ws.addRow(['Tanggal Unduh: 2026-07-20 08:00:00', '', '', '', 'Pengunduh: operator@contoh.sch.id']);

  const groups = ['Data Ayah', 'Data Ibu', 'Data Wali'];
  const top = [...BEFORE, ...groups.flatMap((g) => PARENT_SUB.map(() => g)), ...AFTER];
  const sub = [...BEFORE.map(() => ''), ...groups.flatMap(() => PARENT_SUB), ...AFTER.map(() => '')];
  const h1 = ws.addRow(top).number;
  ws.addRow(sub);
  BEFORE.forEach((_, i) => ws.mergeCells(h1, i + 1, h1 + 1, i + 1));
  groups.forEach((_, g) => {
    const start = BEFORE.length + g * PARENT_SUB.length + 1;
    ws.mergeCells(h1, start, h1, start + PARENT_SUB.length - 1);
  });
  AFTER.forEach((_, i) => {
    const c = BEFORE.length + groups.length * PARENT_SUB.length + i + 1;
    ws.mergeCells(h1, c, h1 + 1, c);
  });

  students.forEach((s, i) => {
    const parent = (name: string | undefined) => [name ?? '', '', '', '', '', ''];
    ws.addRow([
      i + 1, s.name, s.nipd, s.jk, s.nisn, s.tempat, s.lahir, s.nik, 'Islam', 'Jl. Contoh No. 1', '001', '002', 'Contoh', 'Contoh', '40000', '',
      ...parent(s.ayah), ...parent(s.ibu), ...parent(s.wali),
      s.rombel, '', 'SD NEGERI CONTOH', 1,
    ]);
  });
  await wb.xlsx.writeFile(path.join(import.meta.dirname, file));
}

await write('daftar-pd-awal.xlsx', base);
await write('daftar-pd-perubahan.xlsx', later);
process.stdout.write('dapodik fixtures written\n');
