# Contoh impor ketidakhadiran e-Rapor

**Belum ada contoh dari sekolah pilot.** Exporter e-Rapor
(`apps/server/src/modules/report/infrastructure/exporters/erapor/columns.ts`) memakai susunan
sementara di bawah ini dan ditandai `TODO(pilot)`. Jangan anggap susunan ini sudah benar sebelum
dicoba mengimpor ke e-Rapor sekolah pilot.

Susunan sementara: satu lembar per rombel (nama lembar = nama rombel), header di baris 1, satu baris
per siswa.

| No | NIS | NISN | Nama Peserta Didik | Sakit | Izin | Tanpa Keterangan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2627001 | 0091234567 | ANI LESTARI | 2 | 1 | 0 |

Yang perlu dikonfirmasi dengan sekolah pilot:

1. Nama header persis dan nama lembar yang dibaca e-Rapor.
2. Apakah templat impor e-Rapor memuat ID internal (mis. `peserta_didik_id` atau
   `anggota_rombel_id`) yang wajib ada. Bila ya, alurnya diubah: sekolah mengunduh templat dari
   e-Rapor, Absah mengisi kolom S/I/A berdasarkan NISN.
3. Apakah "Tanpa Keterangan" (alpa) termasuk hari terlambat (T). Saat ini T dihitung hadir.

Setelah ada contoh nyata (dianonimkan: nama, NIS, dan NISN karangan), simpan di folder ini sebagai
`ketidakhadiran.xlsx`, perbarui `columns.ts`, dan hapus tanda `TODO(pilot)`.
