import { generateOpenApiDocument } from '@absah/contracts/openapi';
import { toNodeHandler } from 'better-auth/node';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { academicRouter } from './modules/academic';
import { healthRouter, platformRouter, type Auth } from './modules/platform';
import { clientIp } from './shared/client-ip';
import { errorHandler, notFoundHandler } from './shared/http';
import { serializeErr } from './shared/logger';
import { requestId } from './shared/request-id';

export interface AppDeps {
  logger: Logger;
  version: string;
  auth: Auth;
  /** Trusted client IP headers (AUTH_IP_HEADERS). */
  ipHeaders: readonly string[];
  /** Web origin for links in API responses (BETTER_AUTH_URL). */
  appUrl: string;
}

export function createApp({ logger, version, auth, ipHeaders, appUrl }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Cloudflare

  app.use(requestId());
  app.use(clientIp(ipHeaders));
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      // Only method + path: query strings and bodies can contain personal data.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        err: serializeErr,
      },
    }),
  );
  // Better Auth reads the raw body itself, so it is mounted before express.json().
  app.all('/api/auth/{*splat}', toNodeHandler(auth));
  app.use(express.json({ limit: '1mb' }));

  const openapi = generateOpenApiDocument(version);
  const v1 = express.Router();
  v1.use(healthRouter(version));
  v1.use(platformRouter(auth, appUrl));
  v1.use(academicRouter(auth));
  v1.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
