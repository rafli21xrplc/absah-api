import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';

const scope = new AsyncLocalStorage<{ requestId: string }>();

/** Request id of the HTTP request this code runs for, if any (used as outbox trace id). */
export function currentRequestId(): string | undefined {
  return scope.getStore()?.requestId;
}

const INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

/** Accepts a well-formed X-Request-Id from the edge, otherwise mints one; echoes it back. */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && INCOMING_ID.test(incoming) ? incoming : uuidv7();
    res.setHeader('X-Request-Id', req.requestId);
    scope.run({ requestId: req.requestId }, next);
  };
}
