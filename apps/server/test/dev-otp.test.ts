import { afterAll, describe, expect, it } from 'vitest';
import { lastPhoneOtp } from '../src/modules/platform';
import { buildTestApp, testPhone } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

describe('lastPhoneOtp (dev CLI auth:last-otp)', () => {
  it("reads the code Better Auth just sent, and nothing for a number that got none", async () => {
    const user = await t.parent(testPhone(), 'Ortu OTP');
    await t.agent().post('/api/auth/phone-number/send-otp').send({ phoneNumber: user.phoneNumber }).expect(200);
    expect(await lastPhoneOtp(user.phoneNumber)).toBe(t.messageSender.lastCodeFor(user.phoneNumber));
    expect(await lastPhoneOtp(testPhone())).toBeNull();
  });
});
