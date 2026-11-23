import { describe, expect, it } from 'vitest';
import { isLate, minutesOfClock } from './lateness';

describe('minutesOfClock', () => {
  it.each([
    ['00:00', 0],
    ['07:00', 420],
    ['07:30:00', 450],
    ['23:59', 1439],
  ])('%s is %i', (clock, minutes) => expect(minutesOfClock(clock)).toBe(minutes));
});

describe('isLate', () => {
  it.each([
    { name: 'well before the start', at: 6 * 60 + 30, start: '07:00', late: false },
    { name: 'on the minute of the start', at: 7 * 60, start: '07:00', late: false },
    { name: 'one minute after the start', at: 7 * 60 + 1, start: '07:00', late: true },
    { name: 'a later start on another weekday', at: 7 * 60 + 20, start: '07:30', late: false },
    { name: 'midday', at: 12 * 60, start: '07:00', late: true },
    { name: 'a start with seconds', at: 7 * 60 + 31, start: '07:30:00', late: true },
  ])('$name', ({ at, start, late }) => expect(isLate(at, start)).toBe(late));
});
