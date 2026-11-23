import { generateOpenApiDocument } from '@absah/contracts/openapi';
import { toNodeHandler } from 'better-auth/node';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { correctionsRouter, journalRouter, sessionsRouter } from './modules/attendance';
import { gateRouter, kioskCors, kioskRouter, pickupRouter } from './modules/gate';
import { liaisonRouter, linksRouter, portalRouter } from './modules/portal';
import { leaveRouter } from './modules/leave';
import { activitiesRouter, habitsRouter, memorizationRouter } from './modules/activity';
import { tppkRouter, uksRouter } from './modules/student-affairs';
import { pklCheckinsRouter, pklPartnersRouter, pklPlacementsRouter, pklSupervisionRouter } from './modules/pkl';
import { exportsRouter, mbgRouter, reportsRouter } from './modules/report';
import { invoicesRouter, paymentsRouter, paymentWebhookRouter } from './modules/subscription';
import { notificationsRouter, whatsappWebhookRouter, type WhatsappWebhookConfig } from './modules/notify';
import { academicRouter, importsRouter, learningGroupsRouter, registryRouter, scheduleImportRouter, scheduleRouter } from './modules/academic';
import { healthRouter, platformRouter, type Auth } from './modules/platform';
import { clientIp } from './shared/client-ip';
import { maskPath } from './shared/logger';
import { errorHandler, notFoundHandler } from './shared/http';
import { serializeErr } from './shared/logger';
import { requestId } from './shared/request-id';
import type { PaymentProvider } from './shared/payments';
import { FsObjectStorage, fsUploadRouter, type ObjectStorage } from './shared/storage';

export interface AppDeps {
  logger: Logger;
  version: string;
  auth: Auth;
  /** Trusted client IP headers (AUTH_IP_HEADERS). */
  ipHeaders: readonly string[];
  /** Web origin for links in API responses (BETTER_AUTH_URL). */
  appUrl: string;
  storage: ObjectStorage;
  /** Kiosk app origins allowed to call /api/v1/kiosk/* (KIOSK_ORIGINS). */
  kioskOrigins?: readonly string[];
  /** WhatsApp status webhook secrets; without them the webhook route answers 404. */
  whatsappWebhook?: WhatsappWebhookConfig;
  /** Payment gateway (PAYMENT_PROVIDER); null = online payment off. */
  paymentProvider?: PaymentProvider | null;
}

export function createApp({ logger, version, auth, ipHeaders, appUrl, storage, kioskOrigins = [], whatsappWebhook, paymentProvider = null }: AppDeps): Express {
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
        req: (req: { method: string; url: string }) => ({ method: req.method, path: maskPath(req.url.split('?')[0] ?? '') }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        err: serializeErr,
      },
    }),
  );
  app.use('/api/v1/kiosk', kioskCors(kioskOrigins));
  app.use('/api/v1/storage/fs', kioskCors(kioskOrigins));
  // Better Auth reads the raw body itself, so it is mounted before express.json().
  app.all('/api/auth/{*splat}', toNodeHandler(auth));
  // Dev/test stand-in for R2 presigned uploads; also reads the raw body, so before express.json().
  if (storage instanceof FsObjectStorage) app.use('/api/v1', fsUploadRouter(storage));
  // Signed over the raw body, so also before express.json().
  app.use('/api/v1/webhooks/whatsapp', whatsappWebhookRouter(whatsappWebhook));
  app.use('/api/v1/webhooks/payments', paymentWebhookRouter(paymentProvider));
  app.use(express.json({ limit: '1mb' }));

  const openapi = generateOpenApiDocument(version);
  const v1 = express.Router();
  v1.use(healthRouter(version));
  v1.use(linksRouter(storage));
  v1.use(platformRouter(auth, appUrl));
  v1.use(academicRouter(auth));
  v1.use(importsRouter(auth, storage));
  v1.use(registryRouter(auth));
  v1.use(scheduleImportRouter(auth, storage));
  v1.use(scheduleRouter(auth));
  v1.use(learningGroupsRouter(auth));
  v1.use(sessionsRouter(auth));
  v1.use(journalRouter(auth));
  v1.use(correctionsRouter(auth));
  v1.use(leaveRouter(auth, storage));
  v1.use(uksRouter(auth));
  v1.use(tppkRouter(auth));
  v1.use(activitiesRouter(auth));
  v1.use(habitsRouter(auth));
  v1.use(memorizationRouter(auth));
  v1.use(pklPartnersRouter(auth));
  v1.use(pklPlacementsRouter(auth));
  v1.use(pklCheckinsRouter(auth));
  v1.use(pklSupervisionRouter(auth));
  v1.use(gateRouter(auth, storage));
  v1.use(pickupRouter(auth, storage));
  v1.use(kioskRouter(storage));
  v1.use(notificationsRouter(auth));
  v1.use(portalRouter(auth));
  v1.use(liaisonRouter(auth));
  v1.use(reportsRouter(auth));
  v1.use(exportsRouter(auth, storage));
  v1.use(mbgRouter(auth));
  v1.use(invoicesRouter(auth));
  v1.use(paymentsRouter(auth, paymentProvider));
  v1.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
