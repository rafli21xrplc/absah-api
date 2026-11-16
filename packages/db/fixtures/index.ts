import path from 'node:path';

/** Absolute path of an anonymous fixture file, e.g. dapodikFixture('daftar-pd-awal.xlsx'). */
export const dapodikFixture = (file: 'daftar-pd-awal.xlsx' | 'daftar-pd-perubahan.xlsx') =>
  path.join(import.meta.dirname, 'dapodik', file);
