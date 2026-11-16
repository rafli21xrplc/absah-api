import { describe, expect, it } from 'vitest';
import { checkLeaveDates, leaveStatusOf, overlaps } from './leave-rules';

describe('checkLeaveDates', () => {
  const today = '2026-11-16';
  it('accepts up to 30 days, starting at most 7 days back', () => {
    expect(checkLeaveDates({ startsOn: '2026-11-09', endsOn: '2026-12-08' }, today)).toEqual([]);
  });
  it('rejects reversed, too long and too old ranges', () => {
    expect(checkLeaveDates({ startsOn: '2026-11-18', endsOn: '2026-11-17' }, today).map((p) => p.path)).toEqual(['endsOn']);
    expect(checkLeaveDates({ startsOn: '2026-11-16', endsOn: '2026-12-16' }, today).map((p) => p.path)).toEqual(['endsOn']);
    expect(checkLeaveDates({ startsOn: '2026-11-08', endsOn: '2026-11-08' }, today).map((p) => p.path)).toEqual(['startsOn']);
  });
});

describe('leave helpers', () => {
  it('maps sakit to S and izin to I', () => {
    expect([leaveStatusOf('sakit'), leaveStatusOf('izin')]).toEqual(['S', 'I']);
  });
  it('detects ranges sharing a day', () => {
    expect(overlaps({ startsOn: '2026-11-16', endsOn: '2026-11-18' }, { startsOn: '2026-11-18', endsOn: '2026-11-20' })).toBe(true);
    expect(overlaps({ startsOn: '2026-11-16', endsOn: '2026-11-17' }, { startsOn: '2026-11-18', endsOn: '2026-11-20' })).toBe(false);
  });
});
