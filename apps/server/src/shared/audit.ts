import { schema, type Tx } from '@absah/db';
import type { Request } from 'express';
import { sanitizeDiff } from './audit-sanitize';
import { hashValue } from './crypto';
import type { Actor } from './policy';

/** Who did it, where, and which request. Built once per request with auditContext(req, actor). */
export interface AuditContext {
  schoolId: string;
  actorUserId: string | null;
  requestId: string | null;
  ip: string | null;
}

export interface AuditEntity {
  type: string;
  id?: string | null;
}

export interface AuditDiff {
  before?: unknown;
  after?: unknown;
}

const ACTION_RE = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

/**
 * Appends an audit entry (PLT-04) inside the caller's transaction, so the entry exists exactly
 * when the change does. Call it from use cases, not routers. `omitIp` is for flows that must not
 * keep any trace of the client (anonymous TPPK reports).
 */
export async function audit(
  tx: Tx,
  ctx: AuditContext,
  action: string,
  entity: AuditEntity,
  diff: AuditDiff = {},
  options: { omitIp?: boolean } = {},
): Promise<void> {
  if (!ACTION_RE.test(action)) throw new Error(`audit: action must look like "entity.verb", got "${action}"`);
  // No .returning(): audit rows are not readable by most roles (RLS), so RETURNING would fail.
  await tx.insert(schema.auditLogs).values({
    schoolId: ctx.schoolId,
    actorUserId: ctx.actorUserId,
    action,
    entity: entity.type,
    entityId: entity.id ?? null,
    before: sanitizeDiff(diff.before),
    after: sanitizeDiff(diff.after),
    ipHash: options.omitIp || !ctx.ip ? null : hashValue(ctx.ip),
    requestId: ctx.requestId,
  });
}

export function auditContext(req: Request, actor: Actor): AuditContext {
  return {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    requestId: req.requestId,
    ip: req.clientIp ?? null,
  };
}
