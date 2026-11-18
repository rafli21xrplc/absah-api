import { describe, expect, it } from 'vitest';
import { dateLabel, dateRangeLabel, maskPhone, mbgClassesLine, orderedParams, releaseTime, renderTemplate } from './messages';

describe('notify messages', () => {
  it('renders and orders parameters, refusing gaps', () => {
    expect(renderTemplate('{{school}}: {{first_name}} alpa', { school: 'SDN 1', first_name: 'Ani' })).toBe('SDN 1: Ani alpa');
    expect(() => renderTemplate('{{x}}', {})).toThrow('x');
    expect(orderedParams(['b', 'a'], { a: '1', b: '2' })).toEqual(['2', '1']);
  });

  it('formats dates in Indonesian', () => {
    expect(dateLabel('2026-11-16')).toBe('Senin, 16 November 2026');
    expect(dateRangeLabel('2026-11-16', '2026-11-16')).toBe('16 November 2026');
    expect(dateRangeLabel('2026-11-16', '2026-11-18')).toBe('16 - 18 November 2026');
    expect(dateRangeLabel('2026-11-30', '2026-12-02')).toBe('30 November 2026 - 2 Desember 2026');
  });

  it('holds messages in the quiet hours until 06.00 school time', () => {
    const now = new Date('2026-11-16T15:30:20Z'); // 22.30 WIB
    expect(releaseTime(now, 22 * 60 + 30).toISOString()).toBe('2026-11-16T23:00:00.000Z'); // 06.00 WIB
    expect(releaseTime(new Date('2026-11-16T21:10:00Z'), 4 * 60 + 10).toISOString()).toBe('2026-11-16T23:00:00.000Z');
    const day = new Date('2026-11-16T01:00:00Z');
    expect(releaseTime(day, 8 * 60)).toBe(day);
  });

  it('masks phone numbers', () => {
    expect(maskPhone('+6281234567890')).toBe('+62812****7890');
  });
});

describe('mbgClassesLine', () => {
  it('lists every rombel on one line and flags unfilled ones', () => {
    expect(
      mbgClassesLine([
        { name: 'VII A', present: 28, unrecorded: 0 },
        { name: 'VII B', present: 25, unrecorded: 3 },
      ]),
    ).toBe('VII A 28, VII B 25 (3 belum diisi)');
    expect(mbgClassesLine([])).toBe('-');
  });
});

describe('releaseTime with a service window', () => {
  const hours = { start: 6 * 60, end: 18 * 60 };
  it('sends inside the window and holds the rest to the next 06.00', () => {
    const noon = new Date('2026-11-17T05:00:00Z'); // 12.00 WIB
    expect(releaseTime(noon, 12 * 60, hours)).toBe(noon);
    expect(releaseTime(new Date('2026-11-17T12:30:00Z'), 19 * 60 + 30, hours).toISOString()).toBe('2026-11-17T23:00:00.000Z');
    expect(releaseTime(new Date('2026-11-16T21:00:00Z'), 4 * 60, hours).toISOString()).toBe('2026-11-16T23:00:00.000Z');
  });
  it('never goes into the quiet hours, whatever the school sets', () => {
    expect(releaseTime(new Date('2026-11-16T22:00:00Z'), 5 * 60, { start: 0, end: 24 * 60 }).toISOString()).toBe('2026-11-16T23:00:00.000Z');
  });
});
