import { describe, expect, it, vi } from 'vitest';
import { effectiveOverrides, killSwitches } from './capability';
import { addDays, schoolDate } from './school-date';

describe('effectiveOverrides', () => {
  const row = (key: string, value: unknown, previousValue: unknown = null, effectiveFrom: string | null = null) => ({
    key,
    value,
    previousValue,
    effectiveFrom,
  });

  it('applies immediate overrides and skips null (= preset)', () => {
    expect(effectiveOverrides([row('gate.pickup', false), row('mbg.enabled', null)], '2026-11-16')).toEqual({
      'gate.pickup': false,
    });
  });

  it('keeps the previous value until a deferred change takes effect', () => {
    const pending = [row('attendance.mode', 'daily', 'per_period', '2026-11-17')];
    expect(effectiveOverrides(pending, '2026-11-16')).toEqual({ 'attendance.mode': 'per_period' });
    expect(effectiveOverrides(pending, '2026-11-17')).toEqual({ 'attendance.mode': 'daily' });
    // previous null: no override today, the preset applies
    expect(effectiveOverrides([row('attendance.mode', 'daily', null, '2026-11-17')], '2026-11-16')).toEqual({});
  });

  it('ignores unknown keys and wrong kinds, and reports them', () => {
    const onInvalid = vi.fn();
    expect(effectiveOverrides([row('nope.key', true), row('gate.pickup', 'yes')], '2026-11-16', onInvalid)).toEqual({});
    expect(onInvalid).toHaveBeenCalledTimes(2);
  });
});

describe('killSwitches', () => {
  it('lets a school row win over the global row regardless of order', () => {
    const rows = [
      { key: 'pkl.enabled', value: true, schoolId: 'school-1' },
      { key: 'pkl.enabled', value: false, schoolId: null },
      { key: 'mbg.enabled', value: false, schoolId: null },
    ];
    expect(killSwitches(rows)).toEqual({ 'pkl.enabled': true, 'mbg.enabled': false });
  });

  it('ignores invalid rows', () => {
    expect(killSwitches([{ key: 'attendance.mode', value: 'weekly', schoolId: null }])).toEqual({});
  });
});

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
