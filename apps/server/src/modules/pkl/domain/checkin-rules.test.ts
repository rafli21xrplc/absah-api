import { describe, expect, it } from 'vitest';
import { classifyCheckin, clockSkewSeconds, haversineMeters, roundCoordinate, withinWorkHours, type CheckinInput } from './checkin-rules';

// Monas, Jakarta, and points north of it: 0.001 degree of latitude is about 111 m.
const MONAS = { latitude: -6.175392, longitude: 106.827153 };
const north = (metres: number) => ({ latitude: MONAS.latitude + metres / 111_195, longitude: MONAS.longitude });
const HOURS = { startsAt: '08:00:00', endsAt: '16:00:00' };
const now = new Date('2027-01-12T01:00:00Z');

const input = (over: Partial<CheckinInput> = {}): CheckinInput => ({
  kind: 'in',
  point: north(40),
  partner: { ...MONAS, radiusM: 150 },
  hours: HOURS,
  localMinutes: 7 * 60 + 45,
  deviceTime: now,
  serverTime: now,
  hasIndustryMentor: true,
  ...over,
});

describe('haversineMeters', () => {
  it('is zero for one point and symmetric', () => {
    expect(haversineMeters(MONAS, MONAS)).toBe(0);
    expect(haversineMeters(MONAS, north(500))).toBeCloseTo(haversineMeters(north(500), MONAS), 6);
  });

  it('measures known distances within a metre', () => {
    expect(haversineMeters(MONAS, north(150))).toBeCloseTo(150, 0);
    // Monas to Bundaran HI is about 2.4 km.
    expect(haversineMeters(MONAS, { latitude: -6.194963, longitude: 106.823046 })).toBeGreaterThan(2_150);
    expect(haversineMeters(MONAS, { latitude: -6.194963, longitude: 106.823046 })).toBeLessThan(2_300);
  });
});

describe('roundCoordinate', () => {
  it('keeps 4 decimals', () => {
    expect(roundCoordinate(-6.175392)).toBe(-6.1754);
    expect(roundCoordinate(106.827153)).toBe(106.8272);
  });
});

describe('withinWorkHours', () => {
  it('accepts a check-in from an hour before opening until closing', () => {
    expect(withinWorkHours('in', HOURS, 7 * 60)).toBe(true);
    expect(withinWorkHours('in', HOURS, 7 * 60 - 1)).toBe(false);
    expect(withinWorkHours('in', HOURS, 15 * 60 + 59)).toBe(true);
    expect(withinWorkHours('in', HOURS, 16 * 60)).toBe(false);
  });

  it('accepts a check-out from opening until three hours after closing', () => {
    expect(withinWorkHours('out', HOURS, 8 * 60)).toBe(true);
    expect(withinWorkHours('out', HOURS, 7 * 60 + 59)).toBe(false);
    expect(withinWorkHours('out', HOURS, 19 * 60)).toBe(true);
    expect(withinWorkHours('out', HOURS, 19 * 60 + 1)).toBe(false);
  });

  it('never fits a closed day', () => {
    expect(withinWorkHours('in', null, 9 * 60)).toBe(false);
  });
});

describe('clockSkewSeconds', () => {
  it('is absolute', () => {
    expect(clockSkewSeconds(new Date(now.getTime() - 90_000), now)).toBe(90);
    expect(clockSkewSeconds(new Date(now.getTime() + 90_000), now)).toBe(90);
  });
});

describe('classifyCheckin', () => {
  it('waits for the industry supervisor inside the radius and hours', () => {
    expect(classifyCheckin(input())).toEqual({ distanceM: 40, reasons: [], late: false, confirmStatus: 'pending' });
  });

  it('sends a check-in outside the radius to review', () => {
    const c = classifyCheckin(input({ point: north(400) }));
    expect(c.distanceM).toBe(400);
    expect(c.reasons).toEqual(['outside_radius']);
    expect(c.confirmStatus).toBe('needs_review');
  });

  it('counts the radius edge as inside', () => {
    expect(classifyCheckin(input({ point: north(150) })).reasons).toEqual([]);
    expect(classifyCheckin(input({ point: north(152) })).reasons).toEqual(['outside_radius']);
  });

  it('flags a device clock more than 10 minutes off', () => {
    expect(classifyCheckin(input({ deviceTime: new Date(now.getTime() - 10 * 60_000) })).reasons).toEqual([]);
    expect(classifyCheckin(input({ deviceTime: new Date(now.getTime() - 10 * 60_000 - 1000) })).reasons).toEqual(['clock_skew']);
  });

  it('flags a closed day and a check-in after closing', () => {
    expect(classifyCheckin(input({ hours: null })).reasons).toEqual(['outside_hours']);
    expect(classifyCheckin(input({ localMinutes: 17 * 60 })).reasons).toEqual(['outside_hours']);
  });

  it('sends everything to review without an industry supervisor', () => {
    expect(classifyCheckin(input({ hasIndustryMentor: false }))).toMatchObject({ reasons: ['no_industry_mentor'], confirmStatus: 'needs_review' });
  });

  it('marks a check-in after opening time as late', () => {
    expect(classifyCheckin(input({ localMinutes: 8 * 60 })).late).toBe(false);
    expect(classifyCheckin(input({ localMinutes: 8 * 60 + 1 })).late).toBe(true);
  });

  it('never confirms check-outs and never makes them late', () => {
    const c = classifyCheckin(input({ kind: 'out', localMinutes: 16 * 60 + 5, hasIndustryMentor: false }));
    expect(c).toEqual({ distanceM: 40, reasons: [], late: false, confirmStatus: null });
  });

  it('collects several reasons', () => {
    const c = classifyCheckin(input({ point: north(1_000), hours: null, deviceTime: new Date(0) }));
    expect(c.reasons).toEqual(['outside_radius', 'outside_hours', 'clock_skew']);
  });
});
