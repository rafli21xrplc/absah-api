import { schema, type Db } from '@absah/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { phoneNumber, twoFactor } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import type { Config } from '../../../shared/config';
import type { MessageSender } from '../../../shared/messaging/message-sender';
import { devTotpHook } from './dev-totp';

/** Indonesian mobile numbers in E.164 (+62...). Clients normalise before sending. */
export const PHONE_E164_ID = /^\+628\d{7,12}$/;

export interface AuthDeps {
  db: Db;
  config: Pick<
    Config,
    'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'TRUSTED_ORIGINS' | 'AUTH_RATE_LIMIT' | 'AUTH_IP_HEADERS' | 'NODE_ENV' | 'DEV_TOTP_CODE'
  >;
  messageSender: MessageSender;
}

/**
 * Better Auth (PLT-01):
 * - staff: email + password; no public sign-up (accounts come from invitations, prompt 1.5)
 * - TOTP two-factor; required for admin/operator by resolveContext, not by Better Auth itself
 * - parents and industry supervisors: WhatsApp OTP to a phone number already on an account
 * - rate limiting stored in Postgres so the API stays stateless (backup for the Cloudflare WAF)
 */
export function createAuth({ db, config, messageSender }: AuthDeps) {
  return betterAuth({
    appName: 'Absah',
    basePath: '/api/auth',
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
    // Local development only (loadConfig refuses DEV_TOTP_CODE elsewhere; checked here again).
    ...(config.NODE_ENV === 'development' && config.DEV_TOTP_CODE ? { hooks: { before: devTotpHook(config.DEV_TOTP_CODE, config.BETTER_AUTH_SECRET) } } : {}),
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: config.AUTH_RATE_LIMIT,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/*': { window: 60, max: 5 },
        '/phone-number/send-otp': { window: 60, max: 3 },
        '/phone-number/verify': { window: 60, max: 5 },
        '/two-factor/*': { window: 60, max: 5 },
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      ipAddress: { ipAddressHeaders: config.AUTH_IP_HEADERS },
      useSecureCookies: config.NODE_ENV === 'production',
    },
    plugins: [
      twoFactor({ issuer: 'Absah' }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        phoneNumberValidator: (value) => PHONE_E164_ID.test(value),
        // Only numbers already on an account get a code; unknown numbers are silently ignored so
        // the endpoint does not reveal who has an account. No sign-up on verification.
        sendOTP: async ({ phoneNumber: to, code }, ctx) => {
          const existing = await ctx?.context.adapter.findOne({
            model: 'user',
            where: [{ field: 'phoneNumber', value: to }],
          });
          if (!existing) return;
          // Inline on purpose: the user is waiting, there is no school (no tenant outbox) and the
          // route is rate limited. The one exception to rule 3 (CLAUDE.md, Notifications).
          await messageSender.sendOtp({ to, code, purpose: 'login' });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
