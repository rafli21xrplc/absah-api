import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { SENSITIVE_KEYS } from './sensitive-keys';

/**
 * Personal data must never reach logs (CLAUDE.md rule 9). Paths cover the keys at the top
 * level and up to two levels deep (request bodies, nested payloads). Values of encrypted columns
 * are SensitiveText and serialise as "[redacted]" on their own.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["cf-connecting-ip"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];

/**
 * Error serialiser that never emits SQL parameters or values quoted in database messages.
 * Drizzle's DrizzleQueryError puts every bound parameter (names, NISN, phone numbers) into its
 * message, and Postgres messages quote offending values (`invalid input syntax for type uuid: "..."`,
 * `Key (email)=(...) already exists`).
 */
export function serializeErr(err: unknown, depth = 0): Record<string, unknown> {
  if (!(err instanceof Error)) return { type: typeof err, message: '[non-error value thrown]' };
  const out: Record<string, unknown> = { type: err.name || err.constructor.name, message: scrubMessage(err) };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.code = code;
  const query = (err as { query?: unknown }).query;
  if (typeof query === 'string') out.query = query; // placeholders ($1, $2), never values
  if (err.stack) out.stack = err.stack.split('\n').filter((l) => /^\s+at /.test(l)).join('\n');
  if (err.cause !== undefined && depth < 3) out.cause = serializeErr(err.cause, depth + 1);
  return out;
}

function scrubMessage(err: Error): string {
  if ('query' in err && 'params' in err) return 'Failed query (parameters omitted)';
  return err.message
    .replace(/\(([^()]*)\)=\(([^()]*)\)/g, '($1)=([redacted])')
    .replace(/"[^"]*"/g, '"[redacted]"')
    .replace(/'[^']*'/g, "'[redacted]'");
}

export function createLogger(
  options: LoggerOptions & { pretty?: boolean } = {},
  destination?: DestinationStream,
): Logger {
  const { pretty, ...rest } = options;
  const opts: LoggerOptions = {
    base: { service: 'absah-api' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { err: serializeErr, error: serializeErr },
    ...(pretty && !destination ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    ...rest,
  };
  return destination ? pino(opts, destination) : pino(opts);
}

export type { Logger };

/** Request paths as logged: a TPPK tracking code is a secret of the reporter, so it never reaches a log. */
export function maskPath(path: string): string {
  return path.replace(/(\/tppk\/reports\/track\/)[^/]+/, '$1[code]');
}
