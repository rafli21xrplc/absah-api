import { describe, expect, it } from 'vitest';
import { R2ObjectStorage } from './r2-storage';

describe('R2ObjectStorage.presignUpload', () => {
  it('signs a 5-minute PUT that pins the content type and length', async () => {
    // Fake credentials: presigning is local and never calls R2.
    const r2 = new R2ObjectStorage({ accountId: 'acc', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'absah' });
    const key = 'schools/0190f6a0-0000-7000-8000-000000000001/imports/0190f6a0-0000-7000-8000-000000000002';
    const up = await r2.presignUpload({ key, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentLength: 1234 });
    const url = new URL(up.url);
    expect(url.host).toBe('absah.acc.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']));
    expect(up.headers['Content-Type']).toContain('spreadsheetml');
  });
});

describe('R2ObjectStorage.presignDownload', () => {
  it('signs a 5-minute inline GET with the stored content type', async () => {
    const r2 = new R2ObjectStorage({ accountId: 'acc', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', bucket: 'absah' });
    const key = 'schools/0190f6a0-0000-7000-8000-000000000001/leave/0190f6a0-0000-7000-8000-000000000003';
    const url = new URL((await r2.presignDownload({ key, contentType: 'image/jpeg' })).url);
    expect(url.pathname).toBe(`/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-type')).toBe('image/jpeg');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
  });
});
