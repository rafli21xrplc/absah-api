import { z } from 'zod';

/** Stable error codes. Clients branch on these, never on message text. */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TWO_FACTOR_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'CAPABILITY_DISABLED',
  'SCHEDULE_CONFLICT',
  'SESSION_LOCKED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'INTERNAL',
]).meta({ id: 'ErrorCode' });
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every error response body: { code, message, details?, requestId }. */
export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
}).meta({ id: 'ErrorBody' });
export type ErrorBody = z.infer<typeof ErrorBody>;

/** Cursor pagination query, max 100 per page. */
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

/**
 * Idempotency-Key header for mutating requests (PLT-13). Generate one per user action (UUID v4
 * or v7) and reuse it when retrying that same action. Keys are kept 24 hours.
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_\-:.]{8,128}$/, 'Idempotency-Key tidak valid.');
/** Set to "true" on a response replayed from the idempotency store. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';
