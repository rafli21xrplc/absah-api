import { XLSX_CONTENT_TYPE } from '@absah/contracts';
import { dapodikFixture } from '@absah/db/fixtures';
import { readFile } from 'node:fs/promises';
import { uuidv7 } from 'uuidv7';
import { academicConsumers } from '../src/modules/academic';
import { runConsumer } from '../src/shared/outbox';
import type { Agent, TestApp } from './harness';

export type ImportBody = {
  import: { id: string; status: string };
  upload: { url: string; method: string; headers: Record<string, string> };
};
export type Preview = {
  id: string;
  status: string;
  error: string | null;
  academicYear: string | null;
  counts: Record<string, number> | null;
  items: { kind: string; name: string; nisn: string | null; className: string | null; changes: { field: string; from: string | null; to: string | null }[] }[];
};

export const fixture = (name: 'daftar-pd-awal.xlsx' | 'daftar-pd-perubahan.xlsx') => readFile(dapodikFixture(name));

/** Import helpers for one agent in one school, mirroring what the web app does. */
export function importer(t: TestApp, agent: Agent, school: string) {
  const start = async (file: Buffer) =>
    (
      await agent
        .post('/api/v1/imports/dapodik')
        .set('X-School-Id', school)
        .set('Idempotency-Key', `import-${uuidv7()}`)
        .send({ fileName: 'daftar-pd.xlsx', fileSize: file.length, contentType: XLSX_CONTENT_TYPE })
        .expect(201)
    ).body as ImportBody;

  const upload = async (body: ImportBody, file: Buffer) => {
    const url = new URL(body.upload.url);
    await agent.put(url.pathname + url.search).set(body.upload.headers).send(file).expect(200);
  };

  const requestParse = (id: string) => agent.post(`/api/v1/imports/${id}/parse`).set('X-School-Id', school).expect(200);

  /** What the worker does when the outbox relays student_import.uploaded. */
  const runParseJob = async (importId: string) => {
    const [consumer] = academicConsumers(t.storage);
    if (!consumer) throw new Error('no consumer');
    const event = { id: uuidv7(), schoolId: school, type: 'student_import.uploaded', payload: { importId }, traceId: null, occurredAt: new Date().toISOString() };
    return runConsumer(consumer, event);
  };

  const preview = async (id: string) => (await agent.get(`/api/v1/imports/${id}`).set('X-School-Id', school).expect(200)).body as Preview;

  const commit = (id: string, key = `commit-${uuidv7()}`) =>
    agent.post(`/api/v1/imports/${id}/commit`).set('X-School-Id', school).set('Idempotency-Key', key);

  /** Upload + parse: returns the ready preview. */
  const prepare = async (file: Buffer) => {
    const started = await start(file);
    await upload(started, file);
    await requestParse(started.import.id);
    await runParseJob(started.import.id);
    return preview(started.import.id);
  };

  return { start, upload, requestParse, runParseJob, preview, commit, prepare };
}
