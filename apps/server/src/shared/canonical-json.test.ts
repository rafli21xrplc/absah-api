import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';
import { requestHash } from './idempotency';

describe('canonicalJson', () => {
  it('sorts keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('requestHash', () => {
  const base = { method: 'PATCH', originalUrl: '/api/v1/x' };
  it('ignores key order but not values, method or path', () => {
    const h = requestHash({ ...base, body: { a: 1, b: 2 } });
    expect(requestHash({ ...base, body: { b: 2, a: 1 } })).toBe(h);
    expect(requestHash({ ...base, body: { a: 1, b: 3 } })).not.toBe(h);
    expect(requestHash({ ...base, method: 'POST', body: { a: 1, b: 2 } })).not.toBe(h);
    expect(requestHash({ ...base, originalUrl: '/api/v1/y', body: { a: 1, b: 2 } })).not.toBe(h);
  });
});
