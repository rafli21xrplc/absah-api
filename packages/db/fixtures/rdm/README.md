# Contoh RDM (Rapor Digital Madrasah)

**Belum ada contoh asli.** Prompt 5.5 meminta susunan kolom ekspor RDM mengikuti contoh dari madrasah
mitra di folder ini. Sampai contoh itu ada, kolomnya sementara (TODO(pilot)) di
apps/server/src/modules/report/infrastructure/exporters/rdm/columns.ts: No, NIS, NISN, Nama Siswa,
Sakit, Izin, Alpa, satu lembar per rombel, header di baris 1.

Ekspor RDM tertahan di balik flag rilis `rdm-export-beta` (mati bawaan; POST /exports menjawab 409
reason release_flag_off). Tim Absah menyalakannya per madrasah dengan peran owner:

    insert into platform_flags (id, key, value, school_id, reason)
    values (gen_random_uuid(), 'rdm-export-beta', 'true', '<school id>', 'uji RDM bersama madrasah mitra');

Langkah sebelum rilis:
1. Taruh contoh berkas impor ketidakhadiran RDM dari madrasah mitra di sini (anonimkan nama, NISN, NIS).
2. Cocokkan `RDM_COLUMNS` (nama header, urutan, nama lembar, baris header) dan uji impor di RDM.
3. Hapus TODO(pilot), lalu hapus `rdm-export-beta` dari RELEASE_FLAGS dan pemeriksaannya di exports.ts.
