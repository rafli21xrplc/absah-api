import { XLSX_CONTENT_TYPE } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { emisFile, importer } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let operatorId: string;

beforeAll(async () => {
  const o = await t.staff('Operator EMIS');
  operatorId = o.id;
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
});

async function madrasah() {
  const id = await t.school('sma', 'MA EMIS');
  await getDb().db.update(schema.schools).set({ isMadrasah: true }).where(eq(schema.schools.id, id));
  await t.member(id, operatorId, 'operator');
  return id;
}

describe('EMIS import (AKD-09)', () => {
  it('previews and commits like Dapodik, rombel with their jurusan', async () => {
    const school = await madrasah();
    const emis = importer(t, operator, school, 'emis');
    const preview = await emis.prepare(await emisFile());
    expect(preview).toMatchObject({ status: 'ready', error: null, counts: expect.objectContaining({ created: 6, rejected: 0 }) as unknown });
    await emis.commit(preview.id).expect(200);

    const classes = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select({ name: schema.classes.name, grade: schema.classes.grade, stream: schema.classes.stream }).from(schema.classes));
    expect(classes.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'X IPA 1', grade: 10, stream: 'ipa' },
      { name: 'X IPS 1', grade: 10, stream: 'ips' },
      { name: 'XI IPA 1', grade: 11, stream: 'ipa' },
    ]);
    const list = await operator.get('/api/v1/imports').set('X-School-Id', school).expect(200);
    expect((list.body as { items: { source: string }[] }).items[0]?.source).toBe('emis');
  });

  it('is only for schools whose data source is EMIS', async () => {
    const body = { fileName: 'a.xlsx', fileSize: 10, contentType: XLSX_CONTENT_TYPE };
    const sma = await t.school('sma', 'SMA bukan madrasah');
    await t.member(sma, operatorId, 'operator');
    const res = await operator.post('/api/v1/imports/emis').set('X-School-Id', sma).set('Idempotency-Key', `k-${uuidv7()}`).send(body).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    const ma = await madrasah();
    await operator.post('/api/v1/imports/emis').set('X-School-Id', ma).set('Idempotency-Key', `k-${uuidv7()}`).send({ ...body, fileName: '' }).expect(400);
  });
});
