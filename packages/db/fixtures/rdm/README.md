# Contoh RDM (Rapor Digital Madrasah)

**Belum ada contoh asli.** Prompt 5.5 meminta susunan kolom ekspor RDM mengikuti contoh dari madrasah
mitra di folder ini. Sampai contoh itu ada, kolomnya sementara (TODO(pilot)) di
apps/server/src/modules/report/infrastructure/exporters/rdm/columns.ts: No, NIS, NISN, Nama Siswa,
Sakit, Izin, Alpa, satu lembar per rombel, header di baris 1.

Ekspor RDM tertahan di balik flag rilis `rdm-export-beta` (mati bawaan; POST /exports menjawab 409
reason release_flag_off). Tim Absah menyalakannya per madrasah (peran owner dari DATABASE_URL):

    pnpm --filter @absah/server release:flag --flag rdm-export-beta --school <school id> --reason "uji RDM bersama madrasah mitra"

`--off` mematikannya lagi; `--all` (tanpa --school) berlaku untuk semua sekolah.

Langkah sebelum rilis:
1. Taruh contoh berkas impor ketidakhadiran RDM dari madrasah mitra di sini (anonimkan nama, NISN, NIS).
2. Cocokkan `RDM_COLUMNS` (nama header, urutan, nama lembar, baris header) dan uji impor di RDM.
3. Hapus TODO(pilot), lalu hapus `rdm-export-beta` dari RELEASE_FLAGS dan pemeriksaannya di exports.ts.
