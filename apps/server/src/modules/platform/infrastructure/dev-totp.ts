import { createHmac } from 'node:crypto';
import { createAuthMiddleware } from 'better-auth/api';
import { symmetricDecrypt } from 'better-auth/crypto';

/**
 * DEVELOPMENT ONLY. With DEV_TOTP_CODE set (6 digits) and NODE_ENV=development, that fixed code is accepted at the two-factor
 * sign-in step: the hook swaps it for the account's real current code before Better Auth checks it, so everything else
 * (pending-sign-in cookie, attempts, session) runs as usual. loadConfig refuses DEV_TOTP_CODE outside development, and this
 * hook is not even registered there, so a production server can never accept it.
 */

/** RFC 6238 TOTP, SHA-1, 6 digits, 30 s: the settings Better Auth uses by default. Exported for the test. */
export function totpNow(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  // Better Auth keys the HMAC with the secret string itself (createOTP), not with its base32 decoding.
  const mac = createHmac('sha1', Buffer.from(secret)).update(counter).digest();
  const o = (mac[mac.length - 1] ?? 0) & 15;
  const code = (mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export function devTotpHook(devCode: string, secretKey: string) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/two-factor/verify-totp') return;
    const body = ctx.body as { code?: unknown } | undefined;
    if (!body || body.code !== devCode) return;
    // The same lookup Better Auth does: the signed pending-sign-in cookie points at a verification row holding the user id.
    const cookie = ctx.context.createAuthCookie('two_factor');
    const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!identifier) return;
    const pending = await ctx.context.internalAdapter.findVerificationValue(identifier);
    if (!pending) return;
    const row = await ctx.context.adapter.findOne<{ secret: string }>({ model: 'twoFactor', where: [{ field: 'userId', value: pending.value }] });
    if (!row) return;
    const secret = await symmetricDecrypt({ key: secretKey, data: row.secret });
    return { context: { body: { ...body, code: totpNow(secret) } } };
  });
}
