# Contoh ekspor EMIS (anonim, sementara)

`data-siswa.xlsx` dibuat oleh `generate.ts`. Semua nama, NISN, dan NIK karangan; NIK memakai kode
wilayah `990101` yang tidak ada. Jangan pernah menaruh data siswa nyata di sini.

**TODO(pilot):** tata letaknya disusun dari gambaran umum ekspor data siswa EMIS 4.0 (4 baris judul,
satu baris header: No, NIS Lokal, NISN, NIK, Nama Lengkap, Jenis Kelamin, Tempat Lahir, Tanggal
Lahir, Tingkat, Rombel, Nama Ayah, Nama Ibu, Nama Wali, Status), bukan dari berkas asli. Sebelum
madrasah mitra memakai import ini, cocokkan dengan ekspor EMIS mereka (anonimkan dulu), perbarui
`COLUMNS` di apps/server/.../importers/emis/emis-importer.ts dan berkas ini, lalu hapus TODO.

Isi: 6 siswa di X IPA 1, X IPS 1, XI IPA 1; satu NISN tersimpan sebagai angka, satu tanpa NISN,
tanggal lahir dd-mm-yyyy dan dd/mm/yyyy.

Membuat ulang: `pnpm --filter @absah/db fixtures:emis`.
