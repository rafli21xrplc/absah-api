import { describe, expect, it } from 'vitest';
import { gateStatusFor, minutesOf } from './gate-status';

const start = minutesOf('07:00');

describe('gateStatusFor', () => {
  it('daily sessions: H until the school start, T after', () => {
    const daily = { mode: 'daily', startsAt: null, endsAt: null };
    expect(gateStatusFor(daily, minutesOf('06:45'), start)).toBe('H');
    expect(gateStatusFor(daily, minutesOf('07:00'), start)).toBe('H');
    expect(gateStatusFor(daily, minutesOf('07:01'), start)).toBe('T');
  });
  it('lessons: H before, T during, nothing after', () => {
    const lesson = { mode: 'per_period', startsAt: '07:40', endsAt: '08:20' };
    expect(gateStatusFor(lesson, minutesOf('07:30'), start)).toBe('H');
    expect(gateStatusFor(lesson, minutesOf('07:55'), start)).toBe('T');
    expect(gateStatusFor(lesson, minutesOf('08:20'), start)).toBeNull();
  });
});
