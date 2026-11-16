import { describe, expect, it } from 'vitest';
import { parseClassName } from './class-name';

describe('parseClassName', () => {
  it.each([
    ['Kelas 1', 1, null],
    ['Kelas 7A', 7, null],
    ['7 A', 7, null],
    ['VII-A', 7, null],
    ['VII A', 7, null],
    ['VIIIB', 8, null],
    ['IX.C', 9, null],
    ['X IPA 1', 10, 'ipa'],
    ['XI MIPA 2', 11, 'ipa'],
    ['XI IPS 1', 11, 'ips'],
    ['XII Bahasa', 12, 'bahasa'],
    ['XII AGAMA 1', 12, 'keagamaan'],
    ['XII TKJ 2', 12, null],
    ['XIII TKR', 13, null],
    ['IV', 4, null],
    ['VA', 5, null],
  ])('%s -> grade %i, stream %s', (name, grade, stream) => {
    expect(parseClassName(name)).toEqual({ grade, stream });
  });

  it.each(['Rombel Bunga', '', 'Kelas', '14 A'])('%s has no grade', (name) => {
    expect(parseClassName(name)).toBeNull();
  });
});
