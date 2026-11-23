import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Client IP from the trusted header (cf-connecting-ip behind Cloudflare), else the socket. */
    clientIp?: string;
  }
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/** Uses the same trusted headers as auth rate limiting (AUTH_IP_HEADERS). Never logged raw. */
export function clientIp(headers: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    let ip: string | undefined;
    for (const name of headers) {
      const value = req.get(name)?.split(',')[0]?.trim();
      if (value && IP_RE.test(value)) {
        ip = value;
        break;
      }
    }
    req.clientIp = ip ?? req.socket.remoteAddress ?? undefined;
    next();
  };
}
