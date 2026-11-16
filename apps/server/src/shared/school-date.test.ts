import { describe, expect, it } from 'vitest';
import { addDays, schoolDate, schoolMinutes } from './school-date';

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

describe('schoolMinutes', () => {
  it('reads the local clock of each Indonesian timezone', () => {
    const now = new Date('2026-11-16T21:05:00Z');
    expect(schoolMinutes('Asia/Jakarta', now)).toBe(4 * 60 + 5);
    expect(schoolMinutes('Asia/Makassar', now)).toBe(5 * 60 + 5);
    expect(schoolMinutes('Asia/Jayapura', now)).toBe(6 * 60 + 5);
  });
});
