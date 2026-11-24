import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { directoryName } from '../src/shared/directory-name';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

/** Pinned like teacher-leave.test.ts: a Monday morning in Jakarta. */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T03:00:00Z'));
});
afterAll(() => vi.useRealTimers());

describe('directoryName', () => {
  it('writes the column qualified, also in a select of one table', () => {
    // Drizzle leaves a column unqualified in a single-table select; "user_id" inside the subquery would then be the
    // directory's own, and every row would get the same, arbitrary member's name.
    const l = schema.teacherLeaves;
    const { sql: text } = drizzle.mock().select({ name: directoryName(l.userId) }).from(l).where(eq(l.status, 'pending')).toSQL();
    expect(text).toContain('d.user_id = "teacher_leaves"."user_id"');
  });
});

describe('names next to ids are the right person (several members in the school)', () => {
  let school: string;
  const agents: Record<string, Agent> = {};
  const people: Record<string, { id: string; name: string }> = {};

  beforeAll(async () => {
    school = await t.school('smp', 'SMP Nama Anggota');
    // The admin is created first on purpose: it is the row an unqualified subquery would return.
    for (const [label, role] of [['admin', 'admin'], ['guru', 'guru'], ['wakasek', 'wakasek']] as const) {
      const name = `Nama ${label} ${uuidv7().slice(-4)}`;
      const person = await t.staff(name);
      people[label] = { id: person.id, name };
      await t.member(school, person.id, role);
      const agent = t.agent();
      await signIn(agent, person.email).expect(200);
      if (role === 'admin') await enableTotp(agent);
      agents[label] = agent;
    }
  });

  it('shows who asked for a teacher izin and who decided it', async () => {
    const asked = await (agents['guru'] as Agent)
      .post('/api/v1/teacher-leaves')
      .set('X-School-Id', school)
      .set('Idempotency-Key', uuidv7())
      .send({ kind: 'sakit', startsOn: '2026-11-24', endsOn: '2026-11-24', reason: 'Demam tinggi' })
      .expect(201);
    const id = (asked.body as { id: string }).id;
    await (agents['wakasek'] as Agent)
      .post(`/api/v1/teacher-leaves/${id}/decide`)
      .set('X-School-Id', school)
      .set('Idempotency-Key', uuidv7())
      .send({ approve: true })
      .expect(200);

    const listed = await (agents['admin'] as Agent).get('/api/v1/teacher-leaves?status=all').set('X-School-Id', school).expect(200);
    const [leave] = (listed.body as { items: { teacher: { id: string; name: string }; decidedBy: { name: string } | null }[] }).items;
    expect(leave?.teacher).toEqual({ id: people['guru']?.id, name: people['guru']?.name });
    expect(leave?.decidedBy?.name).toBe(people['wakasek']?.name);
  });
});
