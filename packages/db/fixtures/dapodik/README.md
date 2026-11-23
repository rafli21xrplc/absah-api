# Contoh ekspor Dapodik (anonim)

Berkas di folder ini dibuat oleh `generate.ts`. Semua nama, NISN, dan NIK di dalamnya karangan.
NIK memakai kode wilayah `990101` yang tidak ada. Jangan pernah menaruh data siswa nyata di sini.

- `daftar-pd-awal.xlsx`: 10 siswa di rombel VII A, VII B, dan VIII A. Tata letaknya meniru ekspor
  "Daftar Peserta Didik": 4 baris judul dan header 2 baris (Data Ayah/Ibu/Wali digabung). Ada NISN
  tersimpan sebagai angka, beberapa format tanggal, siswa tanpa NISN, dan siswa tanpa NISN maupun NIK.
- `daftar-pd-perubahan.xlsx`: ekspor berikutnya. Satu siswa hilang (calon keluar), satu pindah
  rombel, satu namanya dikoreksi, satu mendapat NISN, dan satu siswa baru.

Membuat ulang: `pnpm --filter @absah/db fixtures:dapodik`.
