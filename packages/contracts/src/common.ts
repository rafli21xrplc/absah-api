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
  'IDEMPOTENCY_KEY_REUSED',
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
