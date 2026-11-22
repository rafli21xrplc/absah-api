import type { WorkspaceExport, WorkspaceExportDownload, WorkspaceExportList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let tppkSchool: string;
let admin: Agent;
let otherAdmin: Agent;
let tppkAdmin: Agent;
let wakasek: Agent;
let kepsek: Agent;
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const post = (agent: Agent, schoolId: string, body: object = {}, key = uuidv7()) => agent.post('/api/v1/workspace/exports').set('X-School-Id', schoolId).set('Idempotency-Key', key).send(body);
const get = (agent: Agent, schoolId: string, path = '') => agent.get(`/api/v1/workspace/exports${path}`).set('X-School-Id', schoolId);

async function adminOf(schoolId: string, name: string) {
  const user = await t.staff(name);
  await t.member(schoolId, user.id, 'admin');
  const agent = t.agent();
  await signIn(agent, user.email).expect(200);
  await enableTotp(agent);
  return { agent, id: user.id };
}

beforeAll(async () => {
  [school, other, tppkSchool] = await Promise.all([t.school('sma', 'SMA Pindah Data'), t.school('sma', 'SMA Lain'), t.school('sma', 'SMA TPPK Admin')]);
  admin = (await adminOf(school, 'Admin Pindah')).agent;
  otherAdmin = (await adminOf(other, 'Admin Lain')).agent;
  const t2 = await adminOf(tppkSchool, 'Admin Anggota TPPK');
  tppkAdmin = t2.agent;
  await getDb().db.insert(schema.tppkMembers).values({ schoolId: tppkSchool, userId: t2.id });
  const [w, k] = await Promise.all([t.staff('Wakasek Pindah'), t.staff('Kepsek Pindah')]);
  await t.member(school, w.id, 'wakasek');
  await t.member(school, k.id, 'kepsek');
  [wakasek, kepsek] = [t.agent(), t.agent()];
  await signIn(wakasek, w.email).expect(200);
  await signIn(kepsek, k.email).expect(200);
});

describe('asking for the workspace (PLT-11)', () => {
  it('is for the admin only, even the kepsek cannot', async () => {
    for (const agent of [wakasek, kepsek]) {
      await post(agent, school).expect(403);
      await get(agent, school).expect(403);
    }
    await t.agent().post('/api/v1/workspace/exports').set('X-School-Id', school).send({}).expect(401);
  });

  it('queues one export, without the tppk schema for an admin who is not on the team, audited', async () => {
    const res = await post(admin, school).expect(202);
    const job = bodyOf<WorkspaceExport>(res);
    expect(job).toMatchObject({ status: 'queued', includeFiles: true, includesTppk: false, fileName: null, sizeBytes: null, error: null });
    const events = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'workspace_export.requested')));
    expect(events.map((e) => (e.payload as { workspaceExportId: string }).workspaceExportId)).toEqual([job.id]);
    const audits = await getDb().db.select({ action: schema.auditLogs.action }).from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'workspace_export.requested')));
    expect(audits).toHaveLength(1);
    expect(bodyOf<WorkspaceExportList>(await get(admin, school).expect(200)).items.map((i) => i.id)).toEqual([job.id]);
  });

  it('refuses a second one while one is waiting, and keeps schools apart', async () => {
    const again = await post(admin, school).expect(409);
    expect((again.body as { details: { reason: string } }).details.reason).toBe('already_queued');
    const [mine] = bodyOf<WorkspaceExportList>(await get(admin, school).expect(200)).items;
    await get(otherAdmin, other, `/${mine?.id}`).expect(404);
    expect(bodyOf<WorkspaceExportList>(await get(otherAdmin, other).expect(200)).items).toEqual([]);
    await post(otherAdmin, other, { includeFiles: false }).expect(202); // another school asks at the same time
  });

  it('includes the tppk schema only for an admin on the TPPK team, and only tables when asked', async () => {
    const job = bodyOf<WorkspaceExport>(await post(tppkAdmin, tppkSchool, { includeFiles: false }).expect(202));
    expect(job).toMatchObject({ includesTppk: true, includeFiles: false });
    await post(admin, school, { includeFiles: 'ya' }).expect(400);
  });

  it('gives a download link only when the file is ready, and audits it', async () => {
    const [mine] = bodyOf<WorkspaceExportList>(await get(admin, school).expect(200)).items;
    const id = mine?.id ?? '';
    const notReady = await get(admin, school, `/${id}/download`).expect(409);
    expect((notReady.body as { details: { reason: string } }).details.reason).toBe('not_ready');

    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select({ fileKey: schema.workspaceExports.fileKey }).from(schema.workspaceExports).where(eq(schema.workspaceExports.id, id)));
    await t.storage.write(row?.fileKey ?? '', Buffer.from('zip bytes'), 'application/zip');
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.workspaceExports).set({ status: 'done', fileName: 'data-sekolah.zip', sizeBytes: 9, tableCount: 3, fileCount: 0, finishedAt: new Date() }).where(eq(schema.workspaceExports.id, id)));

    const link = bodyOf<WorkspaceExportDownload>(await get(admin, school, `/${id}/download`).expect(200));
    expect(link.fileName).toBe('data-sekolah.zip');
    const file = await t.agent().get(new URL(link.url).pathname + new URL(link.url).search).expect(200);
    expect(file.headers['content-disposition']).toContain('data-sekolah.zip');
    const audits = await getDb().db.select({ action: schema.auditLogs.action }).from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'workspace_export.downloaded')));
    expect(audits).toHaveLength(1);
    expect(bodyOf<WorkspaceExport>(await get(admin, school, `/${id}`).expect(200))).toMatchObject({ status: 'done', sizeBytes: 9, tables: 3, files: 0 });
    await post(admin, school).expect(202); // done: the next one may be asked for
  });
});
