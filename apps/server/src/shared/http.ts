import type { ErrorBody } from '@absah/contracts';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError, type z } from 'zod';
import { AppError, NotFoundError } from './errors';

/** Sends a body after validating it against its contract (CLAUDE.md rule 6). */
export function sendContract<S extends z.ZodType>(res: Response, schema: S, body: z.input<S>, status = 200): void {
  res.status(status).json(schema.parse(body));
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Endpoint tidak ditemukan.'));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let body: ErrorBody;
    let status: number;

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details, requestId: req.requestId };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_FAILED',
        message: 'Data yang dikirim tidak valid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: req.requestId,
      };
    } else if (isBodyParserError(err)) {
      status = err.status;
      body = { code: 'VALIDATION_FAILED', message: 'Body request tidak bisa dibaca.', requestId: req.requestId };
    } else {
      status = 500;
      body = { code: 'INTERNAL', message: 'Terjadi kesalahan di server.', requestId: req.requestId };
    }

    if (status >= 500) logger.error({ err, requestId: req.requestId }, 'request failed');
    if (body.details === undefined) delete body.details;
    res.status(status).json(body);
  };
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' && err !== null && 'type' in err && 'status' in err &&
    typeof (err as { status: unknown }).status === 'number' && (err as { status: number }).status < 500
  );
}
