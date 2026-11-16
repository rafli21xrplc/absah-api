import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { type Router } from 'express';
import { assertStorageKey, PRESIGN_TTL_SECONDS, type ObjectStorage, type PresignedUpload } from './object-storage';

/** Largest object the dev upload route accepts. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Dev/test storage on the local disk. Presigned URLs point at this API (via the web proxy) and
 * carry an HMAC over key, expiry, length and type, so they behave like R2 presigned PUTs.
 */
export class FsObjectStorage implements ObjectStorage {
  constructor(
    private readonly dir: string,
    /** Public origin the browser uses, e.g. BETTER_AUTH_URL (the web proxies /api/*). */
    private readonly publicUrl: string,
    private readonly secret: string,
  ) {}

  private file(key: string): string {
    assertStorageKey(key);
    return path.join(this.dir, ...key.split('/'));
  }

  sign(key: string, expires: number, length: number, type: string): string {
    return createHmac('sha256', this.secret).update(`${key}\n${expires}\n${length}\n${type}`).digest('base64url');
  }

  presignUpload({ key, contentType, contentLength }: { key: string; contentType: string; contentLength: number }): Promise<PresignedUpload> {
    assertStorageKey(key);
    const expires = Math.floor(Date.now() / 1000) + PRESIGN_TTL_SECONDS;
    const query = new URLSearchParams({
      expires: String(expires),
      length: String(contentLength),
      sig: this.sign(key, expires, contentLength, contentType),
    });
    return Promise.resolve({
      url: `${this.publicUrl}/api/v1/storage/fs/${key}?${query.toString()}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(expires * 1000),
    });
  }

  presignDownload({ key, contentType }: { key: string; contentType: string }): Promise<{ url: string; expiresAt: Date }> {
    assertStorageKey(key);
    const expires = Math.floor(Date.now() / 1000) + PRESIGN_TTL_SECONDS;
    const query = new URLSearchParams({ expires: String(expires), type: contentType, sig: this.sign(key, expires, -1, `GET ${contentType}`) });
    return Promise.resolve({ url: `${this.publicUrl}/api/v1/storage/fs/${key}?${query.toString()}`, expiresAt: new Date(expires * 1000) });
  }

  async write(key: string, body: Buffer): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}

const signatureMatches = (expected: string, given: unknown) =>
  typeof given === 'string' && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/** PUT and GET /api/v1/storage/fs/schools/... : the dev stand-in for R2 presigned URLs. */
export function fsUploadRouter(storage: FsObjectStorage): Router {
  const router = express.Router();
  router.put('/storage/fs/{*key}', express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    const key = (req.params as { key: string[] }).key.join('/');
    const expires = Number(req.query.expires);
    const length = Number(req.query.length);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    const type = req.get('content-type') ?? '';
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expected = Buffer.from(storage.sign(key, expires, length, type));
    const given = Buffer.from(sig);
    const valid =
      given.length === expected.length &&
      timingSafeEqual(given, expected) &&
      expires * 1000 > Date.now() &&
      body.length === length;
    if (!valid) {
      res.status(403).type('text/plain').send('SignatureDoesNotMatch');
      return;
    }
    await storage.write(key, body);
    res.status(200).end();
  });
  router.get('/storage/fs/{*key}', async (req, res) => {
    const key = (req.params as { key: string[] }).key.join('/');
    const expires = Number(req.query.expires);
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const body = signatureMatches(storage.sign(key, expires, -1, `GET ${type}`), req.query.sig) && expires * 1000 > Date.now() ? await storage.read(key) : null;
    if (!body) {
      res.status(403).type('text/plain').send('AccessDenied');
      return;
    }
    res.status(200).type(type).set('Content-Disposition', 'inline').set('X-Content-Type-Options', 'nosniff').send(body);
  });
  return router;
}
