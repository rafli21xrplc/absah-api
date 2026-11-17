import { loadLocalEnv, parseKeyring } from '@absah/db';
import { z } from 'zod';

function csv(fallback = '') {
  return z
    .string()
    .default(fallback)
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean));
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().default('0.0.0'),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_DIRECT: z.string().url().optional(),
  DB_APP_ROLE: z.string().regex(/^[a-z_][a-z0-9_]*$/).default('absah_app'),
  /** Signs and encrypts auth cookies and TOTP secrets. 32+ random characters per environment. */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Public origin the browser uses (absah-app proxies /api/* to this server). */
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  /** Origins of the kiosk app (static export, calls /api/v1/kiosk/* cross-origin), comma separated. */
  KIOSK_ORIGINS: z
    .string()
    .default('http://localhost:3001')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
  TRUSTED_ORIGINS: csv(),
  AUTH_RATE_LIMIT: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Headers that carry the client IP for auth rate limiting. Behind Cloudflare: cf-connecting-ip. */
  AUTH_IP_HEADERS: csv('cf-connecting-ip'),
  /** Column encryption keys "<id>:<base64 32 bytes>,..."; keep retired keys until data is rotated. */
  ENCRYPTION_KEYS: z.string().min(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  /** HMAC key for IP hashes and tracking codes. 32+ random characters per environment. */
  HASH_KEY: z.string().min(32),
  /** fs = local disk behind a signed dev upload route; r2 = Cloudflare R2 (required in production). */
  STORAGE_DRIVER: z.enum(['fs', 'r2']).default('fs'),
  STORAGE_FS_DIR: z.string().default('.data/storage'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** fake = in memory (dev/test); meta_cloud = WhatsApp Business Platform Cloud API (required in production). */
  WHATSAPP_PROVIDER: z.enum(['fake', 'meta_cloud']).default('fake'),
  WHATSAPP_API_URL: z.url().default('https://graph.facebook.com/v21.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /** App secret: verifies X-Hub-Signature-256 on status webhooks. */
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** Echoed once when the webhook URL is registered (hub.verify_token). */
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE: z.string().default('absah_login_otp_v1'),
  /** none = online payment off; fake = dev/test gateway (never in production). Real gateways come later. */
  PAYMENT_PROVIDER: z.enum(['none', 'fake']).default('none'),
  /** Verifies payment webhooks (the fake gateway signs with it). */
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Validates env once at startup; a bad env stops the process with a readable list of problems. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadLocalEnv();
  const parsed = ConfigSchema.superRefine((c, ctx) => {
    try {
      parseKeyring(c.ENCRYPTION_KEYS, c.ENCRYPTION_ACTIVE_KEY_ID);
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEYS'], message: (e as Error).message });
    }
    if (c.NODE_ENV === 'production' && c.STORAGE_DRIVER !== 'r2') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'must be r2 in production' });
    }
    if (c.NODE_ENV === 'production' && c.WHATSAPP_PROVIDER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_PROVIDER'], message: 'must be a real provider in production' });
    }
    if (c.NODE_ENV === 'production' && c.PAYMENT_PROVIDER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'fake is not allowed in production' });
    }
    if (c.PAYMENT_PROVIDER !== 'none' && !c.PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_WEBHOOK_SECRET'], message: 'required when PAYMENT_PROVIDER is set' });
    }
    if (c.WHATSAPP_PROVIDER === 'meta_cloud') {
      for (const k of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] as const) {
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when WHATSAPP_PROVIDER=meta_cloud' });
      }
    }
    if (c.STORAGE_DRIVER === 'r2') {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when STORAGE_DRIVER=r2' });
      }
    }
  }).safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
