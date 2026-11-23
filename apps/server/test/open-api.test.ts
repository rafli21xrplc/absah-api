import type { CreatedApiKey, OpenDailyAttendance } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKeyHash, newApiKey } from '../src/shared/api-keys';
import { withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const TZ = 'Asia/Jakarta';
const today = schoolDate(TZ);
const yesterday = addDays(today, -1);
let school: string;
let other: string;
let off: string;
let admin: Agent;
let key: string;
let classA: string;
let classB: string;
const enrollments: Record<string, string> = {};
const get = (token: string | null, query = '') => {
  const req = t.agent().get(`/api/v1/open/attendance/daily${query}`);
  return token === null ? req : req.set('Authorization', `Bearer ${token}`);
};
const code = (res: { body: unknown }) => (res.body as { code: string }).code;
const enable = (schoolId: string) => withTenant({ schoolId, userId: null }, (tx) => tx.insert(schema.schoolCapabilities).values({ schoolId, key: 'platform.openApi', value: true }));

/** A school with two rombel and a few students whose daily status is recorded. */
async function seed(schoolId: string, label: string, statuses: [string, 'H' | 'T' | 'S' | 'I' | 'A', string][]) {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [a, b] = await tx
      .insert(schema.classes)
      .values([
        { schoolId, academicYearId: year?.id ?? '', name: `${label} A`, grade: 7 },
        { schoolId, academicYearId: year?.id ?? '', name: `${label} B`, grade: 7 },
      ])
      .returning();
    const ids: Record<string, string> = {};
    for (const [name, status, cls] of statuses) {
      const [student] = await tx.insert(schema.students).values({ schoolId, name }).returning();
      const [enrollment] = await tx.insert(schema.enrollments).values({ schoolId, studentId: student?.id ?? '', classId: cls === 'A' ? (a?.id ?? '') : (b?.id ?? ''), academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
      await tx.insert(schema.dailyAttendance).values({ schoolId, enrollmentId: enrollment?.id ?? '', schoolDate: today, status });
      ids[name] = enrollment?.id ?? '';
    }
    return { classA: a?.id ?? '', classB: b?.id ?? '', ids };
  });
}

beforeAll(async () => {
  [school, other, off] = await Promise.all([t.school('sma', 'SMA Terbuka'), t.school('sma', 'SMA Tetangga'), t.school('sma', 'SMA Tertutup')]);
  await Promise.all([enable(school), enable(other)]);
  const user = await t.staff('Admin Terbuka');
  await t.member(school, user.id, 'admin');
  admin = t.agent();
  await signIn(admin, user.email).expect(200);
  await enableTotp(admin);
  key = ((await admin.post('/api/v1/integrations/api-keys').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ name: 'Uji', scopes: ['attendance:read'], rateLimitPerMinute: 600 }).expect(201)).body as CreatedApiKey).key;

  const mine = await seed(school, 'Kelas', [['SISWA RAHASIA SATU', 'H', 'A'], ['SISWA RAHASIA DUA', 'A', 'A'], ['SISWA RAHASIA TIGA', 'S', 'B']]);
  [classA, classB] = [mine.classA, mine.classB];
  Object.assign(enrollments, mine.ids);
  await seed(other, 'Tetangga', [['MURID SEBELAH', 'H', 'A']]);
});

describe('Open API: daily attendance (PLT-09)', () => {
  it('answers with ids and statuses only: no name, no NISN, nothing personal', async () => {
    const res = await get(key).expect(200);
    const body = res.body as OpenDailyAttendance;
    expect(body.date).toBe(today);
    expect(body.items).toHaveLength(3);
    expect(Object.fromEntries(body.items.map((i) => [i.enrollmentId, i.status]))).toEqual({
      [enrollments['SISWA RAHASIA SATU'] ?? '']: 'H',
      [enrollments['SISWA RAHASIA DUA'] ?? '']: 'A',
      [enrollments['SISWA RAHASIA TIGA'] ?? '']: 'S',
    });
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(['classId', 'enrollmentId', 'status']);
    expect(JSON.stringify(res.body)).not.toMatch(/RAHASIA|MURID/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('filters by rombel and by date; a date without records is an empty list', async () => {
    expect(((await get(key, `?classId=${classB}`).expect(200)).body as OpenDailyAttendance).items.map((i) => i.status)).toEqual(['S']);
    expect(((await get(key, `?classId=${classA}`).expect(200)).body as OpenDailyAttendance).items).toHaveLength(2);
    expect(((await get(key, `?date=${yesterday}`).expect(200)).body as OpenDailyAttendance)).toEqual({ date: yesterday, items: [] });
  });

  it('refuses a future date, one over a year back, and a malformed query', async () => {
    await get(key, `?date=${addDays(today, 1)}`).expect(400);
    await get(key, `?date=${addDays(today, -400)}`).expect(400);
    await get(key, '?date=kemarin').expect(400);
    await get(key, '?classId=bukan-uuid').expect(400);
  });

  it('only sees its own school, even when asking for another school\'s rombel', async () => {
    const otherClass = await withTenant({ schoolId: other, userId: null }, async (tx) => (await tx.select().from(schema.classes))[0]?.id ?? '');
    expect(((await get(key, `?classId=${otherClass}`).expect(200)).body as OpenDailyAttendance).items).toEqual([]);
  });

  it('says the same 401 for no key, a wrong scheme, a malformed key, an unknown key and a revoked one', async () => {
    const unknown = newApiKey(school).key;
    const messages = new Set<string>();
    for (const res of [await get(null), await get('abk_bukan-kunci'), await get(unknown), await t.agent().get('/api/v1/open/attendance/daily').set('Authorization', `Basic ${key}`), await get(key.replace('abk_', 'xyz_'))]) {
      expect(res.status).toBe(401);
      messages.add(String((res.body as { message: string }).message));
    }
    // A session cookie is not a key.
    await admin.get('/api/v1/open/attendance/daily').set('X-School-Id', school).expect(401);

    const fresh = (await admin.post('/api/v1/integrations/api-keys').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ name: 'Segera dicabut', scopes: ['attendance:read'] }).expect(201)).body as CreatedApiKey;
    await get(fresh.key).expect(200);
    await admin.post(`/api/v1/integrations/api-keys/${fresh.id}/revoke`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).expect(200);
    const revoked = await get(fresh.key).expect(401);
    messages.add(String((revoked.body as { message: string }).message));
    expect(messages.size).toBeLessThanOrEqual(2); // "no key" has its own wording at most; unknown and revoked are indistinguishable
    expect(String((revoked.body as { message: string }).message)).toBe(String(((await get(unknown).expect(401)).body as { message: string }).message));
  });

  it('refuses a key without the scope (403), and a school without the open API (404)', async () => {
    const scopeless = newApiKey(school);
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.apiKeys).values({ id: uuidv7(), schoolId: school, name: 'Izin lain', tokenHash: scopeless.hash, scopes: ['students:read'], rateLimitPerMinute: 60 }));
    expect(code(await get(scopeless.key).expect(403))).toBe('FORBIDDEN');

    const closed = newApiKey(off);
    await withTenant({ schoolId: off, userId: null }, (tx) => tx.insert(schema.apiKeys).values({ id: uuidv7(), schoolId: off, name: 'Sekolah tanpa API', tokenHash: closed.hash, scopes: ['attendance:read'], rateLimitPerMinute: 60 }));
    expect(code(await get(closed.key).expect(404))).toBe('CAPABILITY_DISABLED');
  });

  it('a key of one school does not open another: the school id in the key is part of the hash lookup', async () => {
    const secret = key.split('.')[1] ?? '';
    await get(`abk_${other}.${secret}`).expect(401);
  });

  it('counts requests per key: X-RateLimit headers, then 429 with Retry-After at the key\'s own number', async () => {
    const limited = (await admin.post('/api/v1/integrations/api-keys').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ name: 'Pelan', scopes: ['attendance:read'], rateLimitPerMinute: 10 }).expect(201)).body as CreatedApiKey;
    const first = await get(limited.key).expect(200);
    expect(first.headers['x-ratelimit-limit']).toBe('10');
    expect(first.headers['x-ratelimit-remaining']).toBe('9');
    for (let i = 1; i < 10; i++) await get(limited.key).expect(200);
    const refused = await get(limited.key).expect(429);
    expect(code(refused)).toBe('RATE_LIMITED');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['x-ratelimit-remaining']).toBe('0');
    // Another key is not affected.
    await get(key).expect(200);
  });

  it('records the last use, at most once a minute', async () => {
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.tokenHash, apiKeyHash(key.split('.')[1] ?? ''))));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
    const before = row?.lastUsedAt?.getTime();
    await get(key).expect(200);
    const [after] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, row?.id ?? '')));
    expect(after?.lastUsedAt?.getTime()).toBe(before);
  });
});
