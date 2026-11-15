import { schema } from '@absah/db';
import type { Role } from '@absah/contracts';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { inArray } from 'drizzle-orm';
import { pino } from 'pino';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { createApp } from '../src/app';
import { createAuth, createPhoneUser, createStaffUser } from '../src/modules/platform';
import { loadConfig } from '../src/shared/config';
import { initCrypto } from '../src/shared/crypto';
import { closeDb, getDb, initDb } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging/message-sender';

export const TEST_ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'kata-sandi-uji-123';
/** Fixed test-only key (32 zero-ish bytes); never used outside tests. */
export const TEST_ENCRYPTION_KEYS = `test1:${Buffer.alloc(32, 7).toString('base64')}`;

export function buildTestApp() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    BETTER_AUTH_URL: TEST_ORIGIN,
    AUTH_RATE_LIMIT: 'true',
    AUTH_IP_HEADERS: 'cf-connecting-ip',
    ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS,
    ENCRYPTION_ACTIVE_KEY_ID: 'test1',
    HASH_KEY: 'test-hash-key-test-hash-key-test-hash-key',
  });
  initCrypto(config);
  const { db } = initDb(config);
  const messageSender = new FakeMessageSender();
  const auth = createAuth({ db, config, messageSender });
  const app = createApp({ logger: pino({ level: 'silent' }), version: 'test', auth, ipHeaders: config.AUTH_IP_HEADERS });

  const created = { schools: [] as string[], users: [] as string[] };

  return {
    app,
    auth,
    messageSender,
    /** A cookie-keeping client from its own IP, so auth rate limits do not leak between tests. */
    agent(ip = `10.${rnd()}.${rnd()}.${rnd()}`) {
      const agent = request.agent(app);
      agent.set('Origin', TEST_ORIGIN).set('cf-connecting-ip', ip);
      return agent;
    },
    async school(level: 'sd' | 'smp' | 'sma' | 'smk' = 'sma', name = 'Sekolah Uji') {
      const id = uuidv7();
      await getDb().db.insert(schema.schools).values({ id, name, level });
      created.schools.push(id);
      return id;
    },
    async staff(name = 'Staf Uji') {
      const email = `staf-${uuidv7()}@test.local`;
      const { id } = await createStaffUser(auth, { name, email, password: PASSWORD });
      created.users.push(id);
      return { id, email };
    },
    async parent(phoneNumber: string, name = 'Orang Tua Uji') {
      const { id } = await createPhoneUser(auth, { name, phoneNumber });
      created.users.push(id);
      return { id, phoneNumber };
    },
    async member(schoolId: string, userId: string, role: Role, status: 'active' | 'invited' | 'suspended' = 'active') {
      await getDb().db.insert(schema.memberships).values({ schoolId, userId, role, status });
    },
    async cleanup() {
      const { db } = getDb();
      if (created.schools.length) await db.delete(schema.schools).where(inArray(schema.schools.id, created.schools));
      if (created.users.length) await db.delete(schema.user).where(inArray(schema.user.id, created.users));
      await closeDb();
    },
  };
}

export type TestApp = ReturnType<typeof buildTestApp>;
export type Agent = ReturnType<TestApp['agent']>;

/** Unique Indonesian mobile number per call, so reruns never collide with leftovers. */
export function testPhone(): string {
  return `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

function rnd() {
  return Math.floor(Math.random() * 250) + 1;
}

export function signIn(agent: Agent, email: string, password = PASSWORD) {
  return agent.post('/api/auth/sign-in/email').send({ email, password });
}

/** Enables TOTP for the signed-in user and returns a code generator for later sign-ins. */
export async function enableTotp(agent: Agent, password = PASSWORD): Promise<() => Promise<string>> {
  const res = await agent.post('/api/auth/two-factor/enable').send({ password });
  if (res.status !== 200) throw new Error(`enable 2FA failed: ${res.status} ${JSON.stringify(res.body)}`);
  const uri = new URL((res.body as { totpURI: string }).totpURI);
  const secret = new TextDecoder().decode(base32.decode(uri.searchParams.get('secret') ?? ''));
  const nextCode = () => createOTP(secret).totp();
  const verify = await agent.post('/api/auth/two-factor/verify-totp').send({ code: await nextCode() });
  if (verify.status !== 200) throw new Error(`verify 2FA failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  return nextCode;
}

/** Signs in a TOTP user: password step, then the TOTP step. */
export async function signInWithTotp(agent: Agent, email: string, nextCode: () => Promise<string>) {
  const first = await signIn(agent, email);
  if (!(first.body as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
    throw new Error(`expected twoFactorRedirect, got ${first.status} ${JSON.stringify(first.body)}`);
  }
  return agent.post('/api/auth/two-factor/verify-totp').send({ code: await nextCode() });
}
