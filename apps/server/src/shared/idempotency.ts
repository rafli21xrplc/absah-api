import { createHash } from 'node:crypto';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAYED_HEADER, IdempotencyKey } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request, RequestHandler, Response } from 'express';
import { canonicalJson } from './canonical-json';
import { getCtx } from './context';
import { withTenant } from './db';
import { IdempotencyInProgressError, IdempotencyKeyReusedError, ValidationError } from './errors';

/** How long a key (and its stored response) is kept. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** After this, an unfinished request is presumed dead and the key may be taken over. */
export const IDEMPOTENCY_LOCK_MS = 60 * 1000;

type Scope = { schoolId: string; userId: string | null };
type Claim =
  | { kind: 'run'; id: string }
  | { kind: 'replay'; status: number; body: string | null };

/**
 * Idempotency-Key handling for mutating endpoints (PLT-13). Mount after resolveContext with a
 * school and after express.json:
 *
 *   same key + same request   -> stored response, header Idempotent-Replayed: true
 *   same key + other request  -> 422 IDEMPOTENCY_KEY_REUSED
 *   same key, first one busy  -> 409 IDEMPOTENCY_IN_PROGRESS
 *
 * Responses below 500 are stored (encrypted) for 24 hours; a 5xx frees the key so the client can
 * retry. Known gap: if the process dies after the handler commits but before the response is
 * stored, a retry after the lock expires (60 s) runs the handler again. Handlers that must never
 * double-apply also need a natural guard (unique constraint or state check), as membership
 * status changes have.
 */
export function idempotent(): RequestHandler {
  return async (req, res, next) => {
    try {
      const raw = req.get(IDEMPOTENCY_KEY_HEADER);
      if (raw === undefined) {
        throw new ValidationError([{ path: IDEMPOTENCY_KEY_HEADER, message: 'Header wajib diisi.' }]);
      }
      const parsed = IdempotencyKey.safeParse(raw);
      if (!parsed.success) {
        throw new ValidationError([{ path: IDEMPOTENCY_KEY_HEADER, message: 'Format tidak valid.' }]);
      }

      const ctx = getCtx(req);
      if (!ctx.schoolId) throw new Error('idempotent() must run after resolveContext with a school');
      const scope: Scope = { schoolId: ctx.schoolId, userId: ctx.userId };
      const claim = await claimKey(scope, parsed.data, requestHash(req));

      if (claim.kind === 'replay') {
        res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
        if (claim.body === null) res.status(claim.status).end();
        else res.status(claim.status).type('application/json').send(claim.body);
        return;
      }

      captureResponse(req, res, scope, claim.id);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** sha256 over method, path (with query) and the canonical JSON body. */
export function requestHash(req: Pick<Request, 'method' | 'originalUrl' | 'body'>): string {
  return createHash('sha256')
    .update(`${req.method} ${req.originalUrl}\n${canonicalJson(req.body ?? null)}`)
    .digest('base64url');
}

async function claimKey(scope: Scope, key: string, hash: string): Promise<Claim> {
  return withTenant(scope, async (tx) => {
    const now = Date.now();
    const fresh = {
      requestHash: hash,
      status: 'in_progress' as const,
      responseStatus: null,
      responseBody: null,
      lockedUntil: new Date(now + IDEMPOTENCY_LOCK_MS),
      expiresAt: new Date(now + IDEMPOTENCY_TTL_MS),
    };

    const inserted = await tx
      .insert(schema.idempotencyKeys)
      .values({ ...fresh, schoolId: scope.schoolId, userId: scope.userId, key })
      .onConflictDoNothing()
      .returning({ id: schema.idempotencyKeys.id });
    if (inserted[0]) return { kind: 'run', id: inserted[0].id };

    // Someone holds the key: lock the row so two retries cannot both take it over.
    const [row] = await tx
      .select()
      .from(schema.idempotencyKeys)
      .where(keyFilter(scope, key))
      .for('update');
    if (!row) throw new IdempotencyInProgressError(); // deleted (5xx) between our two statements

    const expired = row.expiresAt.getTime() <= now;
    const abandoned = row.status === 'in_progress' && row.lockedUntil.getTime() <= now;
    if (expired || abandoned) {
      await tx.update(schema.idempotencyKeys).set(fresh).where(eq(schema.idempotencyKeys.id, row.id));
      return { kind: 'run', id: row.id };
    }
    if (row.requestHash !== hash) throw new IdempotencyKeyReusedError();
    if (row.status === 'in_progress') throw new IdempotencyInProgressError();
    return { kind: 'replay', status: row.responseStatus ?? 200, body: row.responseBody?.reveal() ?? null };
  });
}

function keyFilter(scope: Scope, key: string) {
  const t = schema.idempotencyKeys;
  return and(
    eq(t.schoolId, scope.schoolId),
    scope.userId === null ? isNull(t.userId) : eq(t.userId, scope.userId),
    eq(t.key, key),
  );
}

/**
 * Stores the response before it is sent, so a client that retries right after getting an answer
 * sees the replay, never a 409. res.send/end without json() is covered on 'finish' (body null).
 */
function captureResponse(req: Request, res: Response, scope: Scope, id: string): void {
  let settled = false;
  const settle = (tx: (t: Tx) => Promise<unknown>) => {
    settled = true;
    return withTenant(scope, tx).catch((err: unknown) => {
      req.log.error({ err, requestId: req.requestId }, 'idempotency: failed to store result');
    });
  };
  const store = (status: number, body: string | null) =>
    status >= 500
      ? settle((tx) => tx.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, id)))
      : settle((tx) =>
          tx
            .update(schema.idempotencyKeys)
            .set({
              status: 'completed',
              responseStatus: status,
              responseBody: body === null ? null : sensitive(body),
              lockedUntil: sql`now()`,
            })
            .where(eq(schema.idempotencyKeys.id, id)),
        );

  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (settled) return json(body);
    void store(res.statusCode, JSON.stringify(body) ?? null).then(() => json(body));
    return res;
  };
  res.on('finish', () => {
    if (!settled) void store(res.statusCode, null);
  });
}
