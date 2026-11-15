import { describe, expect, it } from 'vitest';
import { ErrorBody, HealthResponse } from './index';
import { generateOpenApiDocument } from './openapi';

describe('contracts', () => {
  it('accepts a valid health response and rejects a wrong status', () => {
    const ok = { status: 'ok', service: 'absah-api', version: '0.0.0', time: new Date().toISOString() };
    expect(HealthResponse.parse(ok)).toEqual(ok);
    expect(HealthResponse.safeParse({ ...ok, status: 'down' }).success).toBe(false);
  });

  it('requires a stable code and requestId on errors', () => {
    expect(ErrorBody.safeParse({ code: 'NOT_FOUND', message: 'x', requestId: 'r1' }).success).toBe(true);
    expect(ErrorBody.safeParse({ code: 'SOMETHING_ELSE', message: 'x', requestId: 'r1' }).success).toBe(false);
  });

  it('builds an OpenAPI 3.1 document containing /api/v1/health', () => {
    const doc = generateOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/api/v1/health']?.get).toBeDefined();
  });
});
