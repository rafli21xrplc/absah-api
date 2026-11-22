import type { WorkspaceExport, WorkspaceExportDownload } from '@absah/contracts';
import { schema, SensitiveText } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeOldWorkspaceExports, workspaceExportConsumers } from '../src/modules/workspace-export';
import { EXCLUDED_TABLES, IGNORED_STORAGE_COLUMNS, STORAGE_COLUMNS } from '../src/modules/workspace-export/domain/tables';
import { storageKey } from '../src/shared/storage';
import { storageKeyColumns, tenantTables } from '../src/modules/workspace-export/infrastructure/introspect';
import { hashValue } from '../src/shared/crypto';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let tppkAdmin: Agent;
let plainAdmin: Agent;
const PHONE = '+6281234567890';
const CHRONOLOGY = 'Kronologi rahasia yang hanya boleh dibaca tim TPPK.';
const LETTER = Buffer.from('%PDF-surat-dokter');
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const post = (agent: Agent, body: object = {}) => agent.post('/api/v1/workspace/exports').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send(body);

/** Reads a zip by its central directory, like an unzip tool. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22;
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    files.set(name, Buffer.from(method === 8 ? inflateRawSync(raw) : raw));
    p += 46 + nameLength;
  }
  return files;
}

/** Runs the worker's consumer for an export, as pg-boss would. */
async function build(exportId: string, consumers = workspaceExportConsumers(t.storage), delivery = { attempt: 0, lastAttempt: false }) {
  const [event] = await getDb()
    .db.select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'workspace_export.requested'), sql`${schema.outboxEvents.payload}->>'workspaceExportId' = ${exportId}`));
  const consumer = consumers[0];
  if (!event || !consumer) throw new Error('no export event');
  return runConsumer(consumer, { id: event.id, schoolId: school, type: event.type, payload: event.payload, traceId: null, occurredAt: event.createdAt.toISOString() }, delivery);
}

async function downloadZip(agent: Agent, exportId: string): Promise<Map<string, Buffer>> {
  const link = bodyOf<WorkspaceExportDownload>(await agent.get(`/api/v1/workspace/exports/${exportId}/download`).set('X-School-Id', school).expect(200));
  const url = new URL(link.url);
  const res = await t.agent().get(url.pathname + url.search).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  return unzip(res.body as Buffer);
}

const text = (files: Map<string, Buffer>, name: string) => files.get(name)?.toString('utf8').replace(/^\uFEFF/, '') ?? '';

async function seed(schoolId: string, label: string, tppkUserId?: string) {
  await withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: '5A', grade: 5 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId, name: `ANI ${label}` }).returning();
    const [enrolled] = await tx.insert(schema.enrollments).values({ schoolId, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
    await tx.insert(schema.guardians).values({ schoolId, name: `Ibu ${label}`, phone: new SensitiveText(PHONE), phoneHash: hashValue(PHONE) });
    await tx.insert(schema.gateSecrets).values({ schoolId, secret: new SensitiveText('rahasia-kartu') });
    const leaveId = uuidv7();
    const key = storageKey(schoolId, 'leave', leaveId);
    await t.storage.write(key, LETTER, 'application/pdf');
    await tx.insert(schema.leaveRequests).values({ schoolId, enrollmentId: enrolled?.id ?? '', kind: 'sakit', startsOn: '2026-11-16', endsOn: '2026-11-16', reason: new SensitiveText('Demam tinggi'), attachmentKey: key, attachmentType: 'application/pdf' });
    // A file that is referenced but no longer in storage is listed, not fatal.
    await tx.insert(schema.leaveRequests).values({ schoolId, enrollmentId: enrolled?.id ?? '', kind: 'izin', startsOn: '2026-11-17', endsOn: '2026-11-17', reason: new SensitiveText('Acara keluarga'), attachmentKey: storageKey(schoolId, 'leave', uuidv7()), attachmentType: 'image/jpeg' });
  });
  if (tppkUserId) {
    await getDb().db.insert(schema.tppkMembers).values({ schoolId, userId: tppkUserId });
    await withTenant({ schoolId, userId: tppkUserId }, (tx) => tx.insert(schema.tppkReports).values({ schoolId, category: 'fisik', chronology: new SensitiveText(CHRONOLOGY), reporterRelation: 'guru', trackingCodeHash: hashValue(`kode-${label}`), isAnonymous: false }));
  }
}

beforeAll(async () => {
  [school, other] = await Promise.all([t.school('sd', 'SD Ekspor Data'), t.school('sd', 'SD Ekspor Lain')]);
  const [a, b] = await Promise.all([t.staff('Admin TPPK Data'), t.staff('Admin Biasa Data')]);
  await t.member(school, a.id, 'admin');
  await t.member(school, b.id, 'admin');
  [tppkAdmin, plainAdmin] = [t.agent(), t.agent()];
  await signIn(tppkAdmin, a.email).expect(200);
  await enableTotp(tppkAdmin);
  await signIn(plainAdmin, b.email).expect(200);
  await enableTotp(plainAdmin);
  await seed(school, 'Sekolah', a.id);
  await seed(other, 'LAIN');
});

describe('building the workspace export (PLT-11)', () => {
  it('writes a CSV per table with encrypted cells decrypted, the files, and the tppk schema for a team member', async () => {
    const job = bodyOf<WorkspaceExport>(await post(tppkAdmin).expect(202));
    expect(await build(job.id)).toBe('handled');
    expect(await build(job.id)).toBe('duplicate');

    const done = bodyOf<WorkspaceExport>(await tppkAdmin.get(`/api/v1/workspace/exports/${job.id}`).set('X-School-Id', school).expect(200));
    expect(done).toMatchObject({ status: 'done', includesTppk: true, includeFiles: true, files: 1 });
    expect(done.fileName).toMatch(/^data-sekolah-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(done.tables).toBeGreaterThan(20);

    const files = await downloadZip(tppkAdmin, job.id);
    expect(text(files, 'tabel/students.csv')).toContain('ANI Sekolah');
    expect(text(files, 'tabel/students.csv')).not.toContain('LAIN'); // another school's rows never
    const guardians = text(files, 'tabel/guardians.csv');
    expect(guardians.split('\r\n')[0]).not.toContain('phone_hash');
    expect(guardians).toContain(PHONE);
    expect(guardians).not.toContain('v1:'); // no ciphertext left
    expect(text(files, 'tabel/leave_requests.csv')).toContain('Demam tinggi');
    expect(text(files, 'tabel/tppk/reports.csv')).toContain(CHRONOLOGY);
    expect(text(files, 'tabel/tppk/reports.csv').split('\r\n')[0]).not.toContain('tracking_code_hash');
    for (const secret of ['gate_secrets', 'outbox_events', 'idempotency_keys', 'invitations', 'push_subscriptions']) expect(files.has(`tabel/${secret}.csv`)).toBe(false);
    expect(files.has('tabel/schools.csv')).toBe(true);

    const letters = [...files.keys()].filter((k) => k.startsWith('berkas/leave/'));
    expect(letters).toHaveLength(1);
    expect(files.get(letters[0] ?? '')?.equals(LETTER)).toBe(true);
    const list = text(files, 'berkas/_daftar.csv');
    expect(list).toContain('leave_requests,attachment_key');
    expect(list).toContain('tidak ditemukan di penyimpanan');
    expect(text(files, 'README.txt')).toContain('Skema TPPK (tabel/tppk/) ikut');
  });

  it('leaves the tppk schema out for an admin who is not on the team, and the files out when not asked', async () => {
    const job = bodyOf<WorkspaceExport>(await post(plainAdmin, { includeFiles: false }).expect(202));
    await build(job.id);
    const files = await downloadZip(plainAdmin, job.id);
    expect([...files.keys()].some((k) => k.startsWith('tabel/tppk/'))).toBe(false);
    expect([...files.keys()].some((k) => k.startsWith('berkas/'))).toBe(false);
    expect(files.has('tabel/students.csv')).toBe(true);
    expect(text(files, 'README.txt')).toContain('Skema TPPK tidak ikut');
    expect(text(files, 'README.txt')).toContain('Berkas unggahan tidak diminta');
  });

  it('records a failure on the last attempt and lets the admin ask again', async () => {
    const job = bodyOf<WorkspaceExport>(await post(plainAdmin).expect(202));
    const failing = Object.assign(Object.create(t.storage) as typeof t.storage, { write: () => Promise.reject(new Error('disk penuh')) });
    const consumers = workspaceExportConsumers(failing);
    await expect(build(job.id, consumers, { attempt: 0, lastAttempt: false })).rejects.toThrow('disk penuh');
    await build(job.id, consumers, { attempt: 1, lastAttempt: true }); // would be a duplicate delivery; the first claim rolled back with the error
    const failed = bodyOf<WorkspaceExport>(await plainAdmin.get(`/api/v1/workspace/exports/${job.id}`).set('X-School-Id', school).expect(200));
    expect(failed).toMatchObject({ status: 'failed', error: 'Berkas gagal dibuat. Coba minta ekspor lagi.' });
    await post(plainAdmin).expect(202); // not stuck behind the failure
  });

  it('removes finished exports after seven days', async () => {
    const [finished] = await withTenant({ schoolId: school, userId: null }, (tx) =>
      tx.select({ id: schema.workspaceExports.id, fileKey: schema.workspaceExports.fileKey }).from(schema.workspaceExports).where(eq(schema.workspaceExports.status, 'done')).limit(1),
    );
    expect(await t.storage.read(finished?.fileKey ?? '')).not.toBeNull();
    expect(await purgeOldWorkspaceExports(t.storage, new Date(Date.now() + 3 * 86_400_000))).toBe(0);
    expect(await purgeOldWorkspaceExports(t.storage, new Date(Date.now() + 8 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect(await t.storage.read(finished?.fileKey ?? '')).toBeNull();
    const gone = await plainAdmin.get(`/api/v1/workspace/exports/${finished?.id}/download`).set('X-School-Id', school);
    const expired = gone.status === 409 ? gone : await tppkAdmin.get(`/api/v1/workspace/exports/${finished?.id}/download`).set('X-School-Id', school);
    expect(expired.status).toBe(409);
    expect((expired.body as { details: { reason: string } }).details.reason).toBe('expired');
  });
});

describe('the registry follows the schema', () => {
  it('knows every column that holds an uploaded file', async () => {
    const found = await withTenant({ schoolId: school, userId: null }, (tx) => storageKeyColumns(tx));
    const known = [...STORAGE_COLUMNS, ...IGNORED_STORAGE_COLUMNS].map((c) => `${c.table}.${c.column}`).sort();
    expect(found.map((c) => `${c.table}.${c.column}`)).toEqual(known);
  });

  it('only excludes tables that exist', async () => {
    const tables = new Set((await withTenant({ schoolId: school, userId: null }, (tx) => tenantTables(tx))).map((r) => `${r.schema}.${r.table}`));
    for (const name of EXCLUDED_TABLES) expect(tables.has(name), name).toBe(true);
  });
});
