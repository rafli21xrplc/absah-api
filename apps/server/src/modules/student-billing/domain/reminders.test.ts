import { describe, expect, it } from 'vitest';
import { REMIND_DAYS_BEFORE, remindWindow } from './reminders';

describe('remindWindow', () => {
  it('covers today and the days before the due date, across a month end', () => {
    expect(remindWindow('2026-11-23')).toEqual({ from: '2026-11-23', to: '2026-11-26' });
    expect(remindWindow('2026-11-29')).toEqual({ from: '2026-11-29', to: '2026-12-02' });
    expect(REMIND_DAYS_BEFORE).toBe(3);
  });
});
