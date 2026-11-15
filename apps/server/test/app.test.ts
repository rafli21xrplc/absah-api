import { ErrorBody, HealthResponse } from '@absah/contracts';
import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { AppError } from '../src/shared/errors';
import { errorHandler } from '../src/shared/http';
import { requestId } from '../src/shared/request-id';

const logger = pino({ level: 'silent' });
const app = createApp({ logger, version: '1.2.3' });

describe('GET /api/v1/health', () => {
  it('returns the health contract and a request id', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    const body = HealthResponse.parse(res.body);
    expect(body.version).toBe('1.2.3');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const ok = await request(app).get('/api/v1/health').set('X-Request-Id', 'edge-req-12345');
    expect(ok.headers['x-request-id']).toBe('edge-req-12345');
    const bad = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id with spaces');
    expect(bad.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error format { code, message, details?, requestId }', () => {
  it('unknown route -> 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    const body = ErrorBody.parse(res.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('malformed JSON -> 400 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(ErrorBody.parse(res.body).code).toBe('VALIDATION_FAILED');
  });

  it('AppError keeps its code/status; unknown errors become 500 INTERNAL without leaking', async () => {
    const probe = express();
    probe.use(requestId());
    probe.get('/app-error', () => {
      throw new AppError('CONFLICT', 409, 'Sudah ada.', { field: 'npsn' });
    });
    probe.get('/boom', () => {
      throw new Error('secret stack detail');
    });
    probe.use(errorHandler(logger));

    const conflict = await request(probe).get('/app-error').expect(409);
    expect(conflict.body).toMatchObject({ code: 'CONFLICT', message: 'Sudah ada.', details: { field: 'npsn' } });

    const boom = await request(probe).get('/boom').expect(500);
    expect(ErrorBody.parse(boom.body).code).toBe('INTERNAL');
    expect(JSON.stringify(boom.body)).not.toContain('secret stack detail');
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('serves the generated document', async () => {
    const res = await request(app).get('/api/v1/openapi.json').expect(200);
    const doc = res.body as { openapi: string; info: { version: string } };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('1.2.3');
  });
});
