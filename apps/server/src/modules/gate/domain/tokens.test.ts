import { describe, expect, it } from 'vitest';
import { nextDates, parseKioskToken, parsePairingCode } from './tokens';

const school = '0190f6a0-0000-7000-8000-000000000001';
const kiosk = '0190f6a0-0000-7000-8000-000000000002';
const secret = 'abcdefghijklmnopqrstuvwxyz012345678_-AB';

describe('gate credentials', () => {
  it('parse pairing codes and kiosk tokens, refusing anything else', () => {
    expect(parsePairingCode(` ${school}.${secret} `)).toEqual({ schoolId: school, secret });
    expect(parsePairingCode(`${school}.short`)).toBeNull();
    expect(parsePairingCode(`${school}.${kiosk}.${secret}`)).toBeNull();
    expect(parseKioskToken(`${school}.${kiosk}.${secret}`)).toEqual({ schoolId: school, kioskId: kiosk, secret });
    expect(parseKioskToken(`${school}.${secret}`)).toBeNull();
  });
  it('lists the next school dates across a month end', () => {
    expect(nextDates('2026-11-29', 3)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
  });
});
