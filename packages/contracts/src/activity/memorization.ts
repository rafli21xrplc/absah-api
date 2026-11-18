import { z } from 'zod';

/**
 * Setoran hafalan Al-Qur'an (KEG-03, religious.memorization): the guru tahfidz records what a student
 * recited, per student (not per rombel), so the record carries over academic years.
 */

/** Surah names as written in Indonesian school books, index 0 = surah 1. */
export const SURAH_NAMES = [
  'Al-Fatihah', 'Al-Baqarah', "Ali 'Imran", "An-Nisa'", "Al-Ma'idah", "Al-An'am", "Al-A'raf", 'Al-Anfal', 'At-Taubah', 'Yunus',
  'Hud', 'Yusuf', "Ar-Ra'd", 'Ibrahim', 'Al-Hijr', 'An-Nahl', "Al-Isra'", 'Al-Kahf', 'Maryam', 'Taha',
  "Al-Anbiya'", 'Al-Hajj', "Al-Mu'minun", 'An-Nur', 'Al-Furqan', "Asy-Syu'ara'", 'An-Naml', 'Al-Qasas', "Al-'Ankabut", 'Ar-Rum',
  'Luqman', 'As-Sajdah', 'Al-Ahzab', "Saba'", 'Fatir', 'Yasin', 'As-Saffat', 'Sad', 'Az-Zumar', 'Gafir',
  'Fussilat', 'Asy-Syura', 'Az-Zukhruf', 'Ad-Dukhan', 'Al-Jasiyah', 'Al-Ahqaf', 'Muhammad', 'Al-Fath', 'Al-Hujurat', 'Qaf',
  'Az-Zariyat', 'At-Tur', 'An-Najm', 'Al-Qamar', 'Ar-Rahman', "Al-Waqi'ah", 'Al-Hadid', 'Al-Mujadilah', 'Al-Hasyr', 'Al-Mumtahanah',
  'As-Saff', "Al-Jumu'ah", 'Al-Munafiqun', 'At-Tagabun', 'At-Talaq', 'At-Tahrim', 'Al-Mulk', 'Al-Qalam', 'Al-Haqqah', "Al-Ma'arij",
  'Nuh', 'Al-Jinn', 'Al-Muzzammil', 'Al-Muddassir', 'Al-Qiyamah', 'Al-Insan', 'Al-Mursalat', "An-Naba'", "An-Nazi'at", "'Abasa",
  'At-Takwir', 'Al-Infitar', 'Al-Mutaffifin', 'Al-Insyiqaq', 'Al-Buruj', 'At-Tariq', "Al-A'la", 'Al-Gasyiyah', 'Al-Fajr', 'Al-Balad',
  'Asy-Syams', 'Al-Lail', 'Ad-Duha', 'Asy-Syarh', 'At-Tin', "Al-'Alaq", 'Al-Qadr', 'Al-Bayyinah', 'Az-Zalzalah', "Al-'Adiyat",
  "Al-Qari'ah", 'At-Takasur', "Al-'Asr", 'Al-Humazah', 'Al-Fil', 'Quraisy', "Al-Ma'un", 'Al-Kausar', 'Al-Kafirun', 'An-Nasr',
  'Al-Lahab', 'Al-Ikhlas', 'Al-Falaq', 'An-Nas',
] as const;

/** Number of ayat per surah (Hafs, 6236 in total), index 0 = surah 1. */
export const SURAH_AYAT = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
] as const;

/** "Al-Mulk 1–15". */
export const surahLabel = (surah: number, from: number, to: number) => `${SURAH_NAMES[surah - 1] ?? `Surah ${surah}`} ${from === to ? from : `${from}–${to}`}`;

/** POST /api/v1/memorization-logs (guru_tahfidz, admin). The listener is the user who records it. */
export const CreateMemorizationLogRequest = z
  .object({
    studentId: z.uuid(),
    /** Default today in the school timezone; not in the future. */
    date: z.iso.date().optional(),
    surah: z.int().min(1).max(114),
    juz: z.int().min(1).max(30).nullable().optional(),
    ayatFrom: z.int().min(1),
    ayatTo: z.int().min(1),
    /** Nilai 0–100, optional. */
    score: z.int().min(0).max(100).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((b) => b.ayatTo >= b.ayatFrom, { message: 'Ayat akhir tidak boleh sebelum ayat awal.', path: ['ayatTo'] })
  .refine((b) => b.ayatTo <= (SURAH_AYAT[b.surah - 1] ?? 0), { message: 'Ayat melebihi jumlah ayat surah ini.', path: ['ayatTo'] })
  .meta({ id: 'CreateMemorizationLogRequest' });
export type CreateMemorizationLogRequest = z.infer<typeof CreateMemorizationLogRequest>;

export const MemorizationLog = z
  .object({
    id: z.uuid(),
    studentId: z.uuid(),
    date: z.iso.date(),
    surah: z.int(),
    surahName: z.string(),
    juz: z.int().nullable(),
    ayatFrom: z.int(),
    ayatTo: z.int(),
    score: z.int().nullable(),
    note: z.string().nullable(),
    /** The penyimak; null when that account is gone. */
    listener: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'MemorizationLog' });
export type MemorizationLog = z.infer<typeof MemorizationLog>;

/** GET /api/v1/memorization-logs?studentId: newest first, at most 200. */
export const MemorizationLogQuery = z.object({ studentId: z.uuid() }).meta({ id: 'MemorizationLogQuery' });
export const MemorizationLogList = z
  .object({ studentId: z.uuid(), name: z.string(), canWrite: z.boolean(), items: z.array(MemorizationLog) })
  .meta({ id: 'MemorizationLogList' });
export type MemorizationLogList = z.infer<typeof MemorizationLogList>;

/** GET /api/v1/memorization-logs/students?q= (writers): active students of this year by name, at most 20. */
export const MemorizationStudentQuery = z.object({ q: z.string().trim().min(2, 'Ketik minimal 2 huruf.').max(60) });
export const MemorizationStudentList = z
  .object({ items: z.array(z.object({ studentId: z.uuid(), name: z.string(), className: z.string() })) })
  .meta({ id: 'MemorizationStudentList' });
export type MemorizationStudentList = z.infer<typeof MemorizationStudentList>;
