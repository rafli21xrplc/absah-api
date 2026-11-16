import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertStorageKey, PRESIGN_TTL_SECONDS, type ObjectStorage, type PresignedUpload } from './object-storage';

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Cloudflare R2 through its S3 API. The bucket needs a CORS rule allowing PUT with Content-Type
 * from the web origin. Content-Length is signed, so a client cannot upload more than it declared.
 */
export class R2ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly options: R2Options) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async presignUpload({ key, contentType, contentLength }: { key: string; contentType: string; contentLength: number }): Promise<PresignedUpload> {
    assertStorageKey(key);
    const command = new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
    const url = await getSignedUrl(this.client, command, { expiresIn: PRESIGN_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000) };
  }

  async presignDownload({ key, contentType }: { key: string; contentType: string }): Promise<{ url: string; expiresAt: Date }> {
    assertStorageKey(key);
    const command = new GetObjectCommand({ Bucket: this.options.bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: 'inline' });
    const url = await getSignedUrl(this.client, command, { expiresIn: PRESIGN_TTL_SECONDS });
    return { url, expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000) };
  }

  async read(key: string): Promise<Buffer | null> {
    assertStorageKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
