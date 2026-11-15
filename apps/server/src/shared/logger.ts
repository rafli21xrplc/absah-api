import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Personal data must never reach logs (CLAUDE.md rule 9). Paths cover the keys at the top
 * level and up to two levels deep (request bodies, nested payloads).
 */
const SENSITIVE_KEYS = [
  'name', 'fullName', 'firstName', 'lastName', 'nama',
  'phone', 'phoneNumber', 'nomorHp', 'whatsapp',
  'email', 'nisn', 'nik', 'nip', 'address', 'alamat', 'birthDate',
  'password', 'otp', 'token', 'secret', 'chronology', 'note', 'notes',
];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];

export function createLogger(options: LoggerOptions & { pretty?: boolean } = {}): Logger {
  const { pretty, ...rest } = options;
  return pino({
    base: { service: 'absah-api' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    ...rest,
  });
}

export type { Logger };
