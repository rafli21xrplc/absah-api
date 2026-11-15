import { sensitive } from '@absah/db';
import { describe, expect, it } from 'vitest';
import { MAX_DIFF_BYTES, sanitizeDiff } from './audit-sanitize';

describe('sanitizeDiff', () => {
  it('redacts personal fields at any depth, case-insensitively, and encrypted values', () => {
    expect(
      sanitizeDiff({
        status: 'approved',
        Name: 'Ani',
        guardian: { phoneNumber: '+6281', relation: 'ayah' },
        note: 'x',
        extra: sensitive('rahasia'),
      }),
    ).toEqual({
      status: 'approved',
      Name: '[redacted]',
      guardian: { phoneNumber: '[redacted]', relation: 'ayah' },
      note: '[redacted]',
      extra: '[redacted]',
    });
  });

  it('cuts long strings, long arrays and deep nesting', () => {
    const out = sanitizeDiff({ text: 'a'.repeat(500), list: Array.from({ length: 30 }, (_, i) => i), a: { b: { c: { d: { e: 1 } } } } }) as {
      text: string;
      list: unknown[];
      a: { b: { c: { d: unknown } } };
    };
    expect(out.text).toHaveLength(201);
    expect(out.list).toHaveLength(21);
    expect(out.list.at(-1)).toBe('[+10 more]');
    expect(out.a.b.c.d).toBe('[depth]');
  });

  it('replaces an oversized diff with its keys', () => {
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, 'x'.repeat(150)]));
    const out = sanitizeDiff(big) as { _truncated: boolean; keys: string[] };
    expect(out._truncated).toBe(true);
    expect(out.keys).toHaveLength(50);
    expect(JSON.stringify(out).length).toBeLessThan(MAX_DIFF_BYTES);
  });

  it('normalises dates, bigints and drops functions', () => {
    expect(sanitizeDiff({ at: new Date('2027-01-11T00:00:00Z'), n: 10n, fn: () => 1 })).toEqual({
      at: '2027-01-11T00:00:00.000Z',
      n: '10',
    });
    expect(sanitizeDiff(undefined)).toBeNull();
  });
});
