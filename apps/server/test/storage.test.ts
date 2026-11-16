import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { storageKey } from '../src/shared/storage';
import { buildTestApp } from './harness';

const t = buildTestApp();
const body = Buffer.from('isi berkas uji');

async function presign(length = body.length) {
  const key = storageKey(uuidv7(), 'imports', uuidv7());
  const up = await t.storage.presignUpload({ key, contentType: 'application/octet-stream', contentLength: length });
  return { key, up, path: new URL(up.url).pathname + new URL(up.url).search };
}

describe('fs storage (dev stand-in for R2 presigned uploads)', () => {
  it('accepts a PUT to the presigned URL and reads it back', async () => {
    const { key, up, path } = await presign();
    expect(up.method).toBe('PUT');
    expect(await t.storage.read(key)).toBeNull();
    await t.agent().put(path).set(up.headers).send(body).expect(200);
    expect((await t.storage.read(key))?.toString()).toBe('isi berkas uji');
    await t.storage.remove(key);
    expect(await t.storage.read(key)).toBeNull();
  });

  it('refuses a tampered key, a different size or another content type', async () => {
    const { up, path } = await presign();
    const otherKey = path.replace(/imports\/[0-9a-f-]+/, `imports/${uuidv7()}`);
    await t.agent().put(otherKey).set(up.headers).send(body).expect(403);
    await t.agent().put(path).set(up.headers).send(Buffer.concat([body, body])).expect(403);
    await t.agent().put(path).set('Content-Type', 'text/plain').send(body.toString()).expect(403);
  });

  it('refuses keys outside schools/{id}/{module}/{id}', () => {
    expect(() => storageKey('../etc', 'imports', uuidv7())).toThrow();
  });
});
