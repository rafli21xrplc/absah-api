import { generateOpenApiDocument } from '@absah/contracts/openapi';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { healthRouter } from './modules/platform';
import { errorHandler, notFoundHandler } from './shared/http';
import { requestId } from './shared/request-id';

export interface AppDeps {
  logger: Logger;
  version: string;
}

export function createApp({ logger, version }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Cloudflare

  app.use(requestId());
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
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const openapi = generateOpenApiDocument(version);
  const v1 = express.Router();
  v1.use(healthRouter(version));
  v1.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
