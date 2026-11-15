import { loadLocalEnv } from '@absah/db';
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
  TRUSTED_ORIGINS: csv(),
  AUTH_RATE_LIMIT: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Headers that carry the client IP for auth rate limiting. Behind Cloudflare: cf-connecting-ip. */
  AUTH_IP_HEADERS: csv('cf-connecting-ip'),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Validates env once at startup; a bad env stops the process with a readable list of problems. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadLocalEnv();
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
