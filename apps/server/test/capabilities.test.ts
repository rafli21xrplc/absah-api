import { schema } from '@absah/db';
import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveContext } from '../src/modules/platform';
import { requireCap } from '../src/shared/capability';
import { getDb, withTenant } from '../src/shared/db';
import { errorHandler } from '../src/shared/http';
import { requestId } from '../src/shared/request-id';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, TEST_ORIGIN, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

// The real app plus one route guarded by a capability, as feature modules will mount them.
const guarded = express();
guarded.use(requestId());
guarded.get('/test/pickup', resolveContext(t.auth, { school: 'required' }), requireCap('gate.pickup'), (_req, res) => {
  res.json({ ok: true });
});
guarded.use(t.app);
guarded.use(errorHandler(pino({ level: 'silent' })));

let sd: string;
let smaMadrasah: string;
let guru: Agent;
let userId: string;

beforeAll(async () => {
  sd = await t.school('sd', 'SD Capability');
  smaMadrasah = await t.school('sma', 'MA Capability');
  await getDb().db.update(schema.schools).set({ isMadrasah: true }).where(eq(schema.schools.id, smaMadrasah));
  const u = await t.staff('Guru Capability');
  userId = u.id;
  await t.member(sd, u.id, 'guru');
  await t.member(smaMadrasah, u.id, 'guru');
  guru = request.agent(guarded);
  guru.set('Origin', TEST_ORIGIN).set('cf-connecting-ip', '10.44.0.1');
  await signIn(guru, u.email).expect(200);
});

const caps = async (school: string) => {
  const res = await guru.get('/api/v1/me/context').set('X-School-Id', school).expect(200);
  return (res.body as { active: { capabilities: Record<string, unknown> } }).active.capabilities;
};
const owner = () => getDb().db; // owner writes: overrides via SQL until 1.4b, kill switches always

async function withFlag(row: { key: string; value: unknown; schoolId: string | null }, fn: () => Promise<void>) {
  const [flag] = await owner().insert(schema.platformFlags).values(row).returning({ id: schema.platformFlags.id });
  try {
    await fn();
  } finally {
    if (flag) await owner().delete(schema.platformFlags).where(eq(schema.platformFlags.id, flag.id));
  }
}

describe('capabilities in /me/context', () => {
  it('resolves the profile presets per school', async () => {
    expect(await caps(sd)).toMatchObject({ 'attendance.mode': 'daily', 'gate.pickup': true, 'data.source': 'dapodik' });
    expect(await caps(smaMadrasah)).toMatchObject({
      'attendance.mode': 'per_period',
      'academic.streams': true,
      'data.source': 'emis',
      'religious.worship': true,
    });
  });

  it('is empty without an active school', async () => {
    const res = await guru.get('/api/v1/me/context').expect(200);
    expect(res.body).toMatchObject({ active: null });
  });

  it('applies school overrides over the preset, deferred ones from their date', async () => {
    const tomorrow = addDays(schoolDate('Asia/Jakarta'), 1);
    await owner()
      .insert(schema.schoolCapabilities)
      .values([
        { schoolId: smaMadrasah, key: 'mbg.enabled', value: true },
        { schoolId: smaMadrasah, key: 'data.source', value: 'dapodik' },
        { schoolId: smaMadrasah, key: 'attendance.mode', value: 'daily', previousValue: null, effectiveFrom: tomorrow },
      ]);
    try {
      expect(await caps(smaMadrasah)).toMatchObject({
        'mbg.enabled': true,
        'data.source': 'dapodik',
        'attendance.mode': 'per_period',
      });
    } finally {
      await owner().delete(schema.schoolCapabilities).where(eq(schema.schoolCapabilities.schoolId, smaMadrasah));
    }
  });

  it('lets a kill switch beat the school override, global or per school', async () => {
    await owner().insert(schema.schoolCapabilities).values({ schoolId: sd, key: 'mbg.enabled', value: true });
    try {
      expect((await caps(sd))['mbg.enabled']).toBe(true);
      await withFlag({ key: 'mbg.enabled', value: false, schoolId: null }, async () => {
        expect((await caps(sd))['mbg.enabled']).toBe(false);
        // a per-school row wins over the global one
        await withFlag({ key: 'mbg.enabled', value: true, schoolId: sd }, async () => {
          expect((await caps(sd))['mbg.enabled']).toBe(true);
          expect((await caps(smaMadrasah))['mbg.enabled']).toBe(false);
        });
      });
    } finally {
      await owner().delete(schema.schoolCapabilities).where(eq(schema.schoolCapabilities.schoolId, sd));
    }
  });

  it('ignores stored values the catalog does not accept', async () => {
    await owner().insert(schema.schoolCapabilities).values({ schoolId: sd, key: 'gate.pickup', value: 'yes' });
    try {
      expect((await caps(sd))['gate.pickup']).toBe(true);
    } finally {
      await owner().delete(schema.schoolCapabilities).where(eq(schema.schoolCapabilities.schoolId, sd));
    }
  });
});

describe('requireCap', () => {
  it('passes when the capability is on', async () => {
    await guru.get('/test/pickup').set('X-School-Id', sd).expect(200, { ok: true });
  });

  it('answers 404 CAPABILITY_DISABLED when it is off', async () => {
    const res = await guru.get('/test/pickup').set('X-School-Id', smaMadrasah).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED', details: { capability: 'gate.pickup' } });
  });

  it('follows a kill switch immediately', async () => {
    await withFlag({ key: 'gate.pickup', value: false, schoolId: sd }, async () => {
      await guru.get('/test/pickup').set('X-School-Id', sd).expect(404);
    });
    await guru.get('/test/pickup').set('X-School-Id', sd).expect(200);
  });
});

describe('RLS', () => {
  it('lets the app role read only global flags and its own school, and never write them', async () => {
    await withFlag({ key: 'student.uks', value: false, schoolId: smaMadrasah }, async () => {
      const visible = await withTenant({ schoolId: sd, userId }, (tx) =>
        tx
          .select()
          .from(schema.platformFlags)
          .where(and(eq(schema.platformFlags.key, 'student.uks'))),
      );
      expect(visible).toEqual([]);
      const err = await withTenant({ schoolId: sd, userId }, (tx) =>
        tx.insert(schema.platformFlags).values({ key: 'student.uks', value: true, schoolId: sd }),
      ).catch((e: unknown) => e);
      expect(String((err as { cause?: unknown }).cause)).toContain('permission denied');
    });
  });

  it('isolates school overrides per school', async () => {
    await owner().insert(schema.schoolCapabilities).values({ schoolId: smaMadrasah, key: 'mbg.enabled', value: true });
    try {
      const fromSd = await withTenant({ schoolId: sd, userId }, (tx) =>
        tx.select().from(schema.schoolCapabilities).where(isNull(schema.schoolCapabilities.effectiveFrom)),
      );
      expect(fromSd.filter((r) => r.schoolId === smaMadrasah)).toEqual([]);
    } finally {
      await owner().delete(schema.schoolCapabilities).where(eq(schema.schoolCapabilities.schoolId, smaMadrasah));
    }
  });
});
