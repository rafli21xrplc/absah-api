import type { AttendanceStatus } from '@absah/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, detectPatterns, withoutRecent, type PatternRules, type StudentWindow } from './patterns';

const TODAY = '2026-11-20'; // Friday
const rules = (focus: Partial<PatternRules['focus']> = {}, over: Partial<PatternRules> = {}): PatternRules => ({
  ...DEFAULT_RULES,
  focus: { bolosJam: false, pkl: false, ...focus },
  ...over,
});
/** Recorded school days ending 2026-11-20, one status per day, oldest first. */
const SCHOOL_DAYS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
const week = (statuses: string): StudentWindow['daily'] => {
  const dates = SCHOOL_DAYS.slice(-statuses.length);
  return [...statuses].map((s, i) => ({ date: dates[i] ?? '', status: s as AttendanceStatus }));
};
const window = (statuses: string, extra: Partial<StudentWindow> = {}): StudentWindow => ({ daily: week(statuses), bolosDates: [], pklAbsentDates: [], ...extra });
const kinds = (w: StudentWindow, r = rules(), today = TODAY) => detectPatterns(w, today, r).map((p) => p.kind);

describe('detectPatterns: consecutive alpa', () => {
  it.each([
    { name: 'three alpa in a row up to today', statuses: 'HHHHHAAA', expected: ['consecutive_alpa'] },
    { name: 'two alpa is not yet a pattern', statuses: 'HHHHHHAA', expected: [] },
    { name: 'an H in the middle breaks the streak', statuses: 'HHHAAHA', expected: [] },
    { name: 'izin and sakit are not alpa', statuses: 'HHHASIA', expected: [] },
    { name: 'a long streak is one pattern', statuses: 'HAAAAAAA', expected: ['consecutive_alpa'] },
    { name: 'a streak that already ended is history', statuses: 'AAAHHHH', expected: [] },
  ])('$name', ({ statuses, expected }) => {
    expect(kinds(window(statuses))).toEqual(expected);
  });

  it('lists the dates of the streak, oldest first', () => {
    expect(detectPatterns(window('HHHAAAA'), TODAY, rules())[0]?.dates).toEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  });

  it('ignores a streak whose last day is older than the freshness limit', () => {
    expect(kinds(window('HHHHHAAA'), rules(), '2026-11-30')).toEqual([]);
    expect(kinds(window('HHHHHAAA'), rules(), '2026-11-23')).toEqual(['consecutive_alpa']); // Monday after: 3 days on
  });

  it('works with a threshold the school changes', () => {
    expect(kinds(window('HHHHHHAA'), rules({}, { consecutiveAlpaDays: 2 }))).toEqual(['consecutive_alpa']);
  });
});

describe('detectPatterns: repeated late', () => {
  it.each([
    { name: 'three T within the last week', statuses: 'HTHTHHT', expected: ['repeated_late'] },
    { name: 'two T is fine', statuses: 'HTHHHHT', expected: [] },
    { name: 'T older than the look-back does not count', statuses: 'TTTHHHHHH', expected: [] },
    { name: 'T and A together give both patterns', statuses: 'HTTTAAA', expected: ['consecutive_alpa', 'repeated_late'] },
  ])('$name', ({ statuses, expected }) => {
    expect(kinds(window(statuses))).toEqual(expected);
  });
});

describe('detectPatterns: bolos jam and PKL follow the school focus', () => {
  const extra = { bolosDates: ['2026-11-18', '2026-11-20'], pklAbsentDates: ['2026-11-19', '2026-11-20'] };
  it.each([
    { name: 'neither when the school has no jam pelajaran and no PKL', focus: {}, expected: [] },
    { name: 'bolos jam only with jam pelajaran', focus: { bolosJam: true }, expected: ['bolos_jam'] },
    { name: 'PKL absence only with PKL', focus: { pkl: true }, expected: ['pkl_absence'] },
    { name: 'both for a SMK with jam pelajaran and PKL', focus: { bolosJam: true, pkl: true }, expected: ['bolos_jam', 'pkl_absence'] },
  ])('$name', ({ focus, expected }) => {
    expect(kinds(window('HHHHHHHHH', extra), rules(focus))).toEqual(expected);
  });

  it('needs the threshold in the look-back: one bolos day, or a day older than the window, is not enough', () => {
    const w = (bolosDates: string[]) => window('HHHHHHHHH', { bolosDates });
    expect(kinds(w(['2026-11-20']), rules({ bolosJam: true }))).toEqual([]);
    expect(kinds(w(['2026-11-10', '2026-11-11']), rules({ bolosJam: true }))).toEqual([]);
    expect(kinds(w(['2026-11-19', '2026-11-19', '2026-11-19']), rules({ bolosJam: true }))).toEqual([]); // the same day three times is one day
  });

  it('lists the dates found, oldest first and without repeats', () => {
    const p = detectPatterns(window('HHHHHHHHH', { pklAbsentDates: ['2026-11-20', '2026-11-18', '2026-11-18'] }), TODAY, rules({ pkl: true }));
    expect(p).toEqual([{ kind: 'pkl_absence', dates: ['2026-11-18', '2026-11-20'] }]);
  });
});

describe('detectPatterns: edges', () => {
  it('finds nothing without any recorded day', () => {
    expect(kinds({ daily: [], bolosDates: ['2026-11-20', '2026-11-19'], pklAbsentDates: [] }, rules({ bolosJam: true }))).toEqual([]);
  });

  it('does not depend on the order of the rows', () => {
    const w = window('HHHHHAAA');
    expect(kinds({ ...w, daily: [...w.daily].reverse() })).toEqual(['consecutive_alpa']);
  });

  it('reports each kind at most once', () => {
    const all = detectPatterns(window('TTTAAAA', { bolosDates: ['2026-11-19', '2026-11-20'], pklAbsentDates: ['2026-11-19', '2026-11-20'] }), TODAY, rules({ bolosJam: true, pkl: true }));
    expect(all.map((p) => p.kind)).toEqual(['consecutive_alpa', 'repeated_late', 'bolos_jam', 'pkl_absence']);
  });
});

describe('withoutRecent', () => {
  it('drops the kinds already warned about', () => {
    const found = detectPatterns(window('TTTAAAA'), TODAY, rules());
    expect(withoutRecent(found, new Set(['consecutive_alpa'])).map((p) => p.kind)).toEqual(['repeated_late']);
    expect(withoutRecent(found, new Set()).map((p) => p.kind)).toEqual(['consecutive_alpa', 'repeated_late']);
  });
});
