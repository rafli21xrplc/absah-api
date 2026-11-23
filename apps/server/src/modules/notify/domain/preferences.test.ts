import { describe, expect, it } from 'vitest';
import { releaseTime } from './messages';
import { isMuted, windowFor } from './preferences';

const at = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00+07:00`);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe('isMuted', () => {
  it('mutes only what the parent switched off', () => {
    const pref = { mutedTypes: ['leave_approved'], noLateMessages: false };
    expect(isMuted(pref, 'leave_approved')).toBe(true);
    expect(isMuted(pref, 'absent_marked')).toBe(false);
    expect(isMuted(undefined, 'leave_approved')).toBe(false);
  });

  it('never mutes a safety message, even if a row says so', () => {
    const pref = { mutedTypes: ['unlisted_pickup', 'login_otp', 'tppk_report_received'], noLateMessages: false };
    expect(isMuted(pref, 'unlisted_pickup')).toBe(false);
    expect(isMuted(pref, 'login_otp')).toBe(false);
    expect(isMuted(pref, 'tppk_report_received')).toBe(false);
  });
});

describe('windowFor', () => {
  const late = { mutedTypes: [], noLateMessages: true };

  it('keeps the default hours without the preference', () => {
    expect(windowFor(undefined, undefined)).toEqual({ start: 360, end: 1260 });
    expect(windowFor(undefined, { mutedTypes: [], noLateMessages: false })).toEqual({ start: 360, end: 1260 });
  });

  it('holds a message created at 19.30 until 06.00 with "no late messages"', () => {
    const w = windowFor(undefined, late);
    expect(releaseTime(at('19:30'), minutes('19:30'), w)).toEqual(new Date(at('06:00').getTime() + 86_400_000));
    expect(releaseTime(at('18:59'), minutes('18:59'), w)).toEqual(at('18:59'));
    // Without the preference the same message goes out at once.
    expect(releaseTime(at('19:30'), minutes('19:30'), windowFor(undefined, undefined))).toEqual(at('19:30'));
  });

  it('never widens a narrower window (service hours)', () => {
    expect(windowFor({ start: 480, end: 900 }, late)).toEqual({ start: 480, end: 900 });
  });
});
