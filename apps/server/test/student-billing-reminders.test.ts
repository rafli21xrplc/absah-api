import { schema, sensitive } from '@absah/db';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyConsumers } from '../src/modules/notify';
import { remindDueInstallments } from '../src/modules/student-billing';
import { getDb, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

/** Monday 2026-11-23: 07.30 WIB, 08.30 WIB, and 08.30 WIB the next day. */
const early = new Date('2026-11-23T00:30:00Z');
const morning = new Date('2026-11-23T01:30:00Z');
const nextMorning = new Date('2026-11-24T01:30:00Z');

let school: string;
let off: string;
let sender: FakeMessageSender;
let consumers: Map<string, Consumer>;
const inst: Record<string, string> = {};

const inSchool = <T>(schoolId: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ schoolId, userId: null }, fn);
const events = async (schoolId = school) => (await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, schoolId), eq(schema.outboxEvents.type, 'student_bill.reminder_due'))).orderBy(asc(schema.outboxEvents.createdAt))).map((e) => ({ id: e.id, installmentId: (e.payload as { installmentId: string }).installmentId }));
const nameOf = (installmentId: string) => Object.entries(inst).find(([, id]) => id === installmentId)?.[0];
const run = (name: string, data: unknown) => {
  const consumer = consumers.get(name);
  if (!consumer) throw new Error(`no consumer ${name}`);
  return runConsumer(consumer, data);
};
const notifications = () => inSchool(school, (tx) => tx.select({ id: schema.notifications.id, templateCode: schema.notifications.templateCode, status: schema.notifications.status }).from(schema.notifications).orderBy(asc(schema.notifications.createdAt)));

/** One bill with one installment due on `dueOn`; returns the installment's id. */
async function bill(schoolId: string, enrollment: string, feeTypeId: string, label: string, dueOn: string, opts: { paid?: boolean; status?: 'open' | 'void'; reminded?: boolean } = {}) {
  return inSchool(schoolId, async (tx) => {
    const status = opts.status ?? 'open';
    const [b] = await tx
      .insert(schema.studentBills)
      .values({ schoolId, enrollmentId: enrollment, feeTypeId, period: label, title: `SPP ${label}`, total: 150_000, dueOn, status, ...(status === 'void' ? { voidedAt: new Date(), voidReason: 'x' } : {}) })
      .returning();
    const [i] = await tx.insert(schema.billInstallments).values({ schoolId, billId: b?.id ?? '', number: 1, amount: 150_000, dueOn, paidAt: opts.paid ? new Date() : null, remindedAt: opts.reminded ? new Date() : null }).returning();
    return i?.id ?? '';
  });
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Tagihan Pengingat');
  off = await t.school('sd', 'SD Tagihan Mati');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'student.billing', value: false });
  const setup = async (schoolId: string, guardianPhones: string[]) =>
    inSchool(schoolId, async (tx) => {
      const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
      const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: '3A', grade: 3 }).returning();
      const [student] = await tx.insert(schema.students).values({ schoolId, name: 'ANI LESTARI' }).returning();
      const [enrolled] = await tx.insert(schema.enrollments).values({ schoolId, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
      const guardians = await tx.insert(schema.guardians).values(guardianPhones.map((p, i) => ({ schoolId, name: `Wali ${i}`, phone: sensitive(p) }))).returning();
      await tx.insert(schema.studentGuardians).values(guardians.map((g, i) => ({ schoolId, studentId: student?.id ?? '', guardianId: g.id, relation: (['ibu', 'ayah', 'wali'] as const)[i] ?? 'wali', isPrimary: i === 0 })));
      const [fee] = await tx.insert(schema.feeTypes).values({ schoolId, name: 'SPP', kind: 'spp', defaultAmount: 150_000 }).returning();
      return { enrollment: enrolled?.id ?? '', fee: fee?.id ?? '' };
    });
  const main = await setup(school, ['+6281200000101', '+6281200000102']);
  inst['today'] = await bill(school, main.enrollment, main.fee, 'today', '2026-11-23');
  inst['in3'] = await bill(school, main.enrollment, main.fee, 'in3', '2026-11-26');
  inst['in4'] = await bill(school, main.enrollment, main.fee, 'in4', '2026-11-27');
  inst['yesterday'] = await bill(school, main.enrollment, main.fee, 'yesterday', '2026-11-22');
  inst['paid'] = await bill(school, main.enrollment, main.fee, 'paid', '2026-11-24', { paid: true });
  inst['void'] = await bill(school, main.enrollment, main.fee, 'void', '2026-11-24', { status: 'void' });
  inst['reminded'] = await bill(school, main.enrollment, main.fee, 'reminded', '2026-11-24', { reminded: true });
  const dead = await setup(off, ['+6281200000103']);
  await bill(off, dead.enrollment, dead.fee, 'today', '2026-11-23');
  sender = new FakeMessageSender();
  consumers = new Map(notifyConsumers({ sender, appUrl: 'https://absah.test', now: () => morning }).map((c) => [c.name, c]));
});

describe('remindDueInstallments (TGH-04)', () => {
  it('waits for 08.00 on the school clock', async () => {
    expect(await remindDueInstallments(early)).toBe(0);
    expect(await events()).toEqual([]);
  });

  it('reminds the unpaid installments due today and in the next three days, once', async () => {
    expect(await remindDueInstallments(morning)).toBe(2);
    expect((await events()).map((e) => nameOf(e.installmentId)).sort()).toEqual(['in3', 'today']);
    expect(await remindDueInstallments(morning)).toBe(0); // a repeated run reminds nobody twice
    const rows = await inSchool(school, (tx) => tx.select({ id: schema.billInstallments.id, remindedAt: schema.billInstallments.remindedAt }).from(schema.billInstallments));
    const reminded = rows.filter((r) => r.remindedAt).map((r) => nameOf(r.id)).sort();
    expect(reminded).toEqual(['in3', 'reminded', 'today']); // the paid, void and past-due ones were left alone
  });

  it('reminds the next one when its day comes, and never for a school with billing off', async () => {
    expect(await remindDueInstallments(nextMorning)).toBe(1);
    expect((await events()).map((e) => nameOf(e.installmentId))).toContain('in4');
    expect(await events(off)).toEqual([]);
  });
});

describe('the parents’ WhatsApp (TGH-04)', () => {
  it('sends one message per guardian with the first name and the date, never the amount', async () => {
    const [first] = await events();
    const event = { id: first?.id ?? '', schoolId: school, type: 'student_bill.reminder_due' as const, payload: { installmentId: first?.installmentId }, traceId: null, occurredAt: new Date().toISOString() };
    expect(await run('notify_student_bill_due', event)).toBe('handled');
    expect(await run('notify_student_bill_due', event)).toBe('duplicate');
    await run('notify_student_bill_due', { ...event, id: uuidv7() }); // another event id for the same installment: same dedup key
    const rows = await notifications();
    expect(rows.map((r) => [r.templateCode, r.status])).toEqual([['student_bill_due', 'queued'], ['student_bill_due', 'queued']]);
    const queued = (await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'notification.queued')))).filter((e) => rows.some((r) => r.id === (e.payload as { notificationId: string }).notificationId));
    for (const e of queued) await run('notify_send', { id: e.id, schoolId: school, type: 'notification.queued', payload: e.payload, traceId: null, occurredAt: new Date().toISOString() });
    expect(sender.messages.map((m) => m.to).sort()).toEqual(['+6281200000101', '+6281200000102']);
    const text = sender.messages[0]?.text ?? '';
    expect(text).toMatch(/^SD Tagihan Pengingat: ada tagihan Ani yang jatuh tempo .+\. Detail dan cara bayar: https:\/\/absah\.test\//);
    // The link may carry random characters ("150", "rp"...): look for the amount and the fee type in the words around it.
    expect(text.replace(/https?:\/\/\S+/, '')).not.toMatch(/150|rupiah|Rp|SPP/i);
  });

  it('sends nothing for an installment paid or voided since the reminder was queued', async () => {
    const before = (await notifications()).length;
    const second = (await events()).find((e) => nameOf(e.installmentId) === 'in3');
    await inSchool(school, (tx) => tx.update(schema.billInstallments).set({ paidAt: new Date() }).where(eq(schema.billInstallments.id, second?.installmentId ?? '')));
    const event = { id: second?.id ?? '', schoolId: school, type: 'student_bill.reminder_due' as const, payload: { installmentId: second?.installmentId }, traceId: null, occurredAt: new Date().toISOString() };
    await run('notify_student_bill_due', event);
    expect((await notifications()).length).toBe(before);
  });
});
