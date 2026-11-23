import { describe, expect, it } from 'vitest';
import { bmwPercent, tracerRecap } from './tracer';

describe('tracerRecap (PKL-05)', () => {
  const a = (graduationYear: number, stream: 'ipa' | 'ips' | null, status: 'bekerja' | 'melanjutkan' | 'wirausaha' | 'belum' | null) => ({ graduationYear, stream, status });

  it('groups by angkatan (newest first) and jurusan, and counts BMW of those who answered', () => {
    const recap = tracerRecap([a(2025, 'ips', 'bekerja'), a(2026, 'ipa', 'bekerja'), a(2026, 'ipa', 'melanjutkan'), a(2026, 'ipa', 'belum'), a(2026, 'ipa', null), a(2026, null, 'wirausaha'), a(2026, 'ips', 'belum')]);
    expect(recap.rows.map((r) => [r.graduationYear, r.stream, r.total, r.answered, r.bmwPercent])).toEqual([
      [2026, 'ipa', 4, 3, 66.7],
      [2026, 'ips', 1, 1, 0],
      [2026, null, 1, 1, 100],
      [2025, 'ips', 1, 1, 100],
    ]);
    expect(recap.totals).toMatchObject({ total: 7, answered: 6, counts: { bekerja: 2, melanjutkan: 1, wirausaha: 1, belum: 2 } });
    expect(recap.totals.bmwPercent).toBe(66.7);
  });

  it('has no percentage before anyone answered, and is empty without alumni', () => {
    expect(tracerRecap([a(2026, 'ipa', null)]).rows[0]).toMatchObject({ total: 1, answered: 0, bmwPercent: null });
    expect(tracerRecap([])).toEqual({ rows: [], totals: { total: 0, answered: 0, counts: { bekerja: 0, melanjutkan: 0, wirausaha: 0, belum: 0 }, bmwPercent: null } });
    expect(bmwPercent({ bekerja: 0, melanjutkan: 0, wirausaha: 0, belum: 0 })).toBeNull();
  });
});
