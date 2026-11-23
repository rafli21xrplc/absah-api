import { describe, expect, it } from 'vitest';
import { isLockDue, planActivitySessions, planPklSessions, planSessions, reminderDueAt } from './session-plan';

const day = {
  classes: [
    { id: 'c1', homeroomTeacherId: 'w1' },
    { id: 'c2', homeroomTeacherId: null },
  ],
  slots: [
    { id: 's1', ownerType: 'class' as const, ownerId: 'c1', teacherId: 't1' },
    { id: 's2', ownerType: 'group' as const, ownerId: 'g1', teacherId: null },
  ],
};

describe('planSessions', () => {
  it('makes one daily session per rombel owned by the wali kelas', () => {
    expect(planSessions('daily', day)).toEqual([
      { mode: 'daily', ownerType: 'class', ownerId: 'c1', slotId: null, teacherId: 'w1' },
      { mode: 'daily', ownerType: 'class', ownerId: 'c2', slotId: null, teacherId: null },
    ]);
  });

  it('makes one session per lesson, rombel or group, in per_period mode', () => {
    expect(planSessions('per_period', day).map((s) => [s.ownerType, s.ownerId, s.slotId, s.teacherId])).toEqual([
      ['class', 'c1', 's1', 't1'],
      ['group', 'g1', 's2', null],
    ]);
  });
});

describe('reminders and locking', () => {
  it('reminds daily sessions at 10.00 and lessons 10 minutes after they end', () => {
    expect(reminderDueAt({ mode: 'daily', periodEndsAt: null })).toBe(600);
    expect(reminderDueAt({ mode: 'per_period', periodEndsAt: '07:40:00' })).toBe(470);
    expect(reminderDueAt({ mode: 'per_period', periodEndsAt: null })).toBeNull();
  });

  it('locks a day at 23.59 and catches up on earlier days', () => {
    expect(isLockDue('2026-11-16', '2026-11-16', 23 * 60 + 58)).toBe(false);
    expect(isLockDue('2026-11-16', '2026-11-16', 23 * 60 + 59)).toBe(true);
    expect(isLockDue('2026-11-15', '2026-11-16', 1)).toBe(true);
  });
});

describe('planActivitySessions', () => {
  const base = { id: 'a', days: [1, 6], startsOn: null, endsOn: null, active: true };
  it('plans active activities on their weekdays inside their dates', () => {
    expect(planActivitySessions([base], '2026-11-23', 1)).toEqual([{ mode: 'activity', ownerType: 'activity', ownerId: 'a', slotId: null, teacherId: null, activityId: 'a' }]);
    expect(planActivitySessions([base], '2026-11-24', 2)).toEqual([]);
    expect(planActivitySessions([{ ...base, active: false }], '2026-11-23', 1)).toEqual([]);
    expect(planActivitySessions([{ ...base, startsOn: '2026-11-24' }], '2026-11-23', 1)).toEqual([]);
    expect(planActivitySessions([{ ...base, endsOn: '2026-11-22' }], '2026-11-23', 1)).toEqual([]);
    expect(planActivitySessions([{ ...base, startsOn: '2026-11-23', endsOn: '2026-11-23' }], '2026-11-23', 1)).toHaveLength(1);
    // Kemah: no weekdays, a date range: every day of it; without both dates never.
    const kemah = { ...base, days: [], startsOn: '2026-11-24', endsOn: '2026-11-26' };
    expect(planActivitySessions([kemah], '2026-11-25', 3)).toHaveLength(1);
    expect(planActivitySessions([kemah], '2026-11-27', 5)).toEqual([]);
    expect(planActivitySessions([{ ...base, days: [] }], '2026-11-25', 3)).toEqual([]);
  });
});

describe('planPklSessions', () => {
  const placement = { id: 'p', startsOn: '2027-01-04', endsOn: '2027-03-31', workDays: [1, 2, 3, 4, 5, 6] };

  it('plans one session per placement on DUDI work days inside the period', () => {
    expect(planPklSessions([placement], '2027-01-04', 1)).toEqual([{ mode: 'pkl', ownerType: 'placement', ownerId: 'p', slotId: null, teacherId: null, pklPlacementId: 'p' }]);
    expect(planPklSessions([placement], '2027-01-09', 6)).toHaveLength(1);
    expect(planPklSessions([placement], '2027-01-10', 7)).toEqual([]);
  });

  it('skips dates outside the period', () => {
    expect(planPklSessions([placement], '2027-01-01', 5)).toEqual([]);
    expect(planPklSessions([placement], '2027-03-31', 3)).toHaveLength(1);
    expect(planPklSessions([placement], '2027-04-01', 4)).toEqual([]);
  });
});
