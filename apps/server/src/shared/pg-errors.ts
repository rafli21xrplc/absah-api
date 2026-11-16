/** Postgres error code and constraint, looking through Drizzle's wrapper (err.cause). */
function pgError(err: unknown): { code?: string; constraint?: string } | undefined {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; depth++) {
    const candidate = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return { code: candidate.code, constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined };
    }
    e = candidate.cause;
  }
  return undefined;
}

/** True when err is a unique violation (23505), optionally of one named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  return pg?.code === '23505' && (constraint === undefined || pg.constraint === constraint);
}
