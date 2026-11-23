import { resolveCapabilities } from '@absah/capabilities';
import { describe, expect, it } from 'vitest';
import { pinsForProfileChange, planOverride } from './capability-settings';

const today = '2026-11-16';
const tomorrow = '2026-11-17';

describe('planOverride', () => {
  it('changes immediate keys now and deletes on null', () => {
    expect(planOverride('gate.pickup', undefined, false, true, today, tomorrow)).toEqual({
      value: false,
      previousValue: null,
      effectiveFrom: null,
    });
    expect(planOverride('gate.pickup', undefined, null, true, today, tomorrow)).toBeNull();
  });

  it('defers attendance.mode to tomorrow, keeping today’s override', () => {
    const current = { key: 'attendance.mode', value: 'daily', previousValue: null, effectiveFrom: null };
    expect(planOverride('attendance.mode', current, 'per_period', 'per_period', today, tomorrow)).toEqual({
      value: 'per_period',
      previousValue: 'daily',
      effectiveFrom: tomorrow,
    });
    expect(planOverride('attendance.mode', undefined, null, 'per_period', today, tomorrow)).toBeNull();
    expect(planOverride('attendance.mode', current, null, 'per_period', today, tomorrow)).toEqual({
      value: null,
      previousValue: 'daily',
      effectiveFrom: tomorrow,
    });
  });

  it('cancels a pending change when today’s value is requested again', () => {
    const pending = { key: 'attendance.mode', value: 'daily', previousValue: 'per_period', effectiveFrom: tomorrow };
    expect(planOverride('attendance.mode', pending, 'per_period', 'per_period', today, tomorrow)).toEqual({
      value: 'per_period',
      previousValue: null,
      effectiveFrom: null,
    });
    const pendingFromPreset = { ...pending, previousValue: null };
    expect(planOverride('attendance.mode', pendingFromPreset, null, 'per_period', today, tomorrow)).toBeNull();
    // today's value comes from the preset: asking for it explicitly is no change today either
    expect(planOverride('attendance.mode', pendingFromPreset, 'per_period', 'per_period', today, tomorrow)).toEqual({
      value: 'per_period',
      previousValue: null,
      effectiveFrom: null,
    });
  });
});

describe('pinsForProfileChange', () => {
  const sma = resolveCapabilities({ level: 'sma', isMadrasah: false });
  const sd = resolveCapabilities({ level: 'sd', isMadrasah: false });

  it('pins attendance.mode when the preset would switch it today', () => {
    expect(Object.fromEntries(pinsForProfileChange(sma, sd, new Map(), today, tomorrow))).toEqual({
      'attendance.mode': { value: null, previousValue: 'per_period', effectiveFrom: tomorrow },
    });
  });

  it('does nothing when an override decides or nothing changes', () => {
    const overridden = new Map([
      ['attendance.mode', { key: 'attendance.mode', value: 'per_period', previousValue: null, effectiveFrom: null }],
    ]);
    expect(pinsForProfileChange(sma, sd, overridden, today, tomorrow).size).toBe(0);
    expect(pinsForProfileChange(sma, sma, new Map(), today, tomorrow).size).toBe(0);
  });

  it('keeps a pending change but pins today to the old preset', () => {
    const pending = new Map([
      ['attendance.mode', { key: 'attendance.mode', value: 'daily', previousValue: null, effectiveFrom: tomorrow }],
    ]);
    expect(pinsForProfileChange(sma, sd, pending, today, tomorrow).get('attendance.mode')).toEqual({
      value: 'daily',
      previousValue: 'per_period',
      effectiveFrom: tomorrow,
    });
  });
});
