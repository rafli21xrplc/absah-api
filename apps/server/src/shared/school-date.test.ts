import { describe, expect, it } from 'vitest';
import { addDays, schoolDate } from './school-date';

describe('school dates', () => {
  it('uses the school timezone', () => {
    const lateUtc = new Date('2026-11-16T18:30:00Z'); // 01:30 on the 17th in Jakarta
    expect(schoolDate('Asia/Jakarta', lateUtc)).toBe('2026-11-17');
    expect(schoolDate('UTC', lateUtc)).toBe('2026-11-16');
  });

  it('adds calendar days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
