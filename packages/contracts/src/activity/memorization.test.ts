import { describe, expect, it } from 'vitest';
import { CreateMemorizationLogRequest, SURAH_AYAT, SURAH_NAMES, surahLabel } from './memorization';

describe('memorization contract', () => {
  it('knows all 114 surah and 6236 ayat', () => {
    expect(SURAH_NAMES).toHaveLength(114);
    expect(SURAH_AYAT).toHaveLength(114);
    expect(SURAH_AYAT.reduce((a, b) => a + b, 0)).toBe(6236);
    expect(surahLabel(67, 1, 15)).toBe('Al-Mulk 1–15');
    expect(surahLabel(112, 4, 4)).toBe('Al-Ikhlas 4');
  });

  it('checks the ayat range against the surah', () => {
    const base = { studentId: '0190a3c4-0000-7000-8000-000000000001', surah: 67 };
    expect(CreateMemorizationLogRequest.safeParse({ ...base, ayatFrom: 1, ayatTo: 30 }).success).toBe(true);
    expect(CreateMemorizationLogRequest.safeParse({ ...base, ayatFrom: 1, ayatTo: 31 }).success).toBe(false);
    expect(CreateMemorizationLogRequest.safeParse({ ...base, ayatFrom: 10, ayatTo: 5 }).success).toBe(false);
  });
});
