import { describe, expect, it } from 'vitest';
import { deviceDayKey, makeCardToken, parseCardToken, schoolDayKey, toBase64Url, verifyCardToken, windowAt } from './card-token';

const secret = new Uint8Array(32).fill(7);
const otherSchool = new Uint8Array(32).fill(9);
const cardId = '0190f6a0-0000-7000-8000-000000000001';
const deviceId = '0190f6a0-0000-7000-8000-0000000000aa';
const otherDevice = '0190f6a0-0000-7000-8000-0000000000bb';
const tz = 'Asia/Jakarta';
const at = Date.parse('2026-11-17T00:30:05Z'); // 07.30 WIB

async function tokenFor(device: string, ms: number, school = secret) {
  const day = await schoolDayKey(school, '2026-11-17');
  return makeCardToken({ cardId, deviceId: device, deviceKey: await deviceDayKey(day, device), ms });
}
const kioskKeys = async (date: string) => (date === '2026-11-17' ? schoolDayKey(secret, date) : null);

describe('card tokens (GRB-01)', () => {
  it('round-trips and stays short enough for a small QR', async () => {
    const token = await tokenFor(deviceId, at);
    expect(token.length).toBeLessThan(80);
    expect(parseCardToken(token)).toMatchObject({ cardId, deviceId, window: windowAt(at) });
    expect(await verifyCardToken(token, at + 20_000, tz, kioskKeys)).toEqual({ ok: true, cardId, deviceId, schoolDate: '2026-11-17' });
  });

  it('expires after about a minute (a screenshot is useless later)', async () => {
    const token = await tokenFor(deviceId, at);
    expect((await verifyCardToken(token, at + 60_000, tz, kioskKeys)).ok).toBe(true);
    expect(await verifyCardToken(token, at + 120_000, tz, kioskKeys)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects tokens of another school, a forged device and tampering', async () => {
    expect(await verifyCardToken(await tokenFor(deviceId, at, otherSchool), at, tz, kioskKeys)).toEqual({ ok: false, reason: 'bad_signature' });
    // Device A's key cannot sign for device B.
    const day = await schoolDayKey(secret, '2026-11-17');
    const forged = await makeCardToken({ cardId, deviceId: otherDevice, deviceKey: await deviceDayKey(day, deviceId), ms: at });
    expect(await verifyCardToken(forged, at, tz, kioskKeys)).toEqual({ ok: false, reason: 'bad_signature' });
    const token = await tokenFor(deviceId, at);
    const parts = token.split('.');
    const tampered = [parts[0], parts[1], parts[2], toBase64Url(new Uint8Array(16))].join('.');
    expect(await verifyCardToken(tampered, at, tz, kioskKeys)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await verifyCardToken('https://example.com', at, tz, kioskKeys)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('needs the key of the school date the window falls on', async () => {
    const tomorrow = Date.parse('2026-11-17T17:00:10Z'); // 00.00 WIB on the 18th
    const day = await schoolDayKey(secret, '2026-11-18');
    const token = await makeCardToken({ cardId, deviceId, deviceKey: await deviceDayKey(day, deviceId), ms: tomorrow });
    expect(await verifyCardToken(token, tomorrow, tz, kioskKeys)).toEqual({ ok: false, reason: 'no_key' });
  });
});
