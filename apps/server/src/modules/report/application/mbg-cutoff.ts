import { MBG_DEFAULT_CUTOFF, type MbgDaily } from '@absah/contracts';
import type { Tx } from '@absah/db';
import type { Logger } from 'pino';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { changedCounts, countMbg, isCutoffDue, type MbgCount } from '../domain/mbg';
import { canManageMbg } from '../domain/policies';
import {
  attendanceDay,
  currentCounts,
  cutoffRows,
  enrolledWithStatus,
  insertCounts,
  lockMbgDay,
  mbgClasses,
  mbgJobSchools,
  mbgSettingsOf,
  schoolTimezone,
  type MbgJobSchool,
} from '../infrastructure/mbg-repo';
import { mbgDaily } from './mbg';

const freshCounts = async (tx: Tx, date: string) => countMbg(await mbgClasses(tx), await enrolledWithStatus(tx, date));

/** Whether the PIC gets a message: only with a number (the counts are kept either way). */
const hasPic = async (tx: Tx) => Boolean((await mbgSettingsOf(tx))?.picPhone);

/**
 * One school's cutoff count (RKP-08): on a school day with mbg.enabled, once the school clock passes
 * the cutoff, store present per rombel and hand the numbers to notify. Runs once per date.
 */
export function countCutoffForSchool(school: MbgJobSchool, now: Date): Promise<{ schoolDate: string; classes: number } | null> {
  return withTenant({ schoolId: school.id, userId: null }, async (tx) => {
    const date = schoolDate(school.timezone, now);
    if (!resolveFromRows(school, await readCapabilityRows(tx), date)['mbg.enabled']) return null;
    const settings = await mbgSettingsOf(tx);
    if (!isCutoffDue(schoolMinutes(school.timezone, now), settings?.cutoffTime ?? MBG_DEFAULT_CUTOFF)) return null;
    // Sessions not generated: not a school day, or the PRS job has not run yet (checked again later).
    if (!(await attendanceDay(tx, date))?.generatedAt) return null;

    await lockMbgDay(tx, school.id, date);
    if ((await cutoffRows(tx, date)).length > 0) return null;
    const counts = await freshCounts(tx, date);
    if (counts.length === 0) return null;
    const send = Boolean(settings?.picPhone);
    await insertCounts(
      tx,
      counts.map((c) => ({ schoolId: school.id, classId: c.classId, schoolDate: date, enrolled: c.enrolled, presentAtCutoff: c.present, unrecorded: c.unrecorded, sentAt: send ? now : null })),
    );
    if (send) await emit(tx, 'mbg.count_ready', { schoolDate: date, correction: false });
    return { schoolDate: date, classes: counts.length };
  });
}

/** Job rkp.mbg-cutoff: every 5 minutes, each school on its own clock. */
export async function countDueCutoffs(now = new Date(), logger?: Logger): Promise<number> {
  // withPlatform: the scheduled job lists schools across tenants; each count runs in withTenant.
  const schools = await withPlatform(mbgJobSchools);
  let counted = 0;
  for (const school of schools) {
    try {
      if (await countCutoffForSchool(school, now)) counted += 1;
    } catch (err) {
      // One broken school must not stop the others; the next run tries again.
      logger?.error({ err, schoolId: school.id }, 'mbg cutoff failed for school');
    }
  }
  return counted;
}

/**
 * POST /mbg/daily/recount (admin): today's numbers again, after the cutoff. Rombel whose numbers
 * changed get a new row superseding the stored one (the sent row never changes) and the PIC gets a
 * correction message. Nothing changed: nothing written, nothing sent.
 */
export async function recountMbg(actor: Actor, auditCtx: AuditContext, now = new Date()): Promise<MbgDaily> {
  authorize(actor, canManageMbg);
  const date = await withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const day = schoolDate(await schoolTimezone(tx, actor.schoolId), now);
    await lockMbgDay(tx, actor.schoolId, day);
    const stored = await currentCounts(tx, day);
    if (stored.length === 0) throw new ConflictError('Angka hari ini belum dihitung. Koreksi bisa dibuat setelah jam batas.', { reason: 'not_counted' });
    const byClass = new Map<string, MbgCount & { id: string }>(stored.map((r) => [r.classId, { id: r.id, enrolled: r.enrolled, present: r.present, unrecorded: r.unrecorded }]));
    const changed = changedCounts(byClass, await freshCounts(tx, day));
    if (changed.length === 0) return day;
    const send = await hasPic(tx);
    await insertCounts(
      tx,
      changed.map((c) => ({
        schoolId: actor.schoolId,
        classId: c.classId,
        schoolDate: day,
        enrolled: c.enrolled,
        presentAtCutoff: c.present,
        unrecorded: c.unrecorded,
        sentAt: send ? now : null,
        supersedesId: byClass.get(c.classId)?.id ?? null,
        createdBy: actor.userId,
      })),
    );
    await audit(tx, auditCtx, 'mbg.recounted', { type: 'mbg_day', id: day }, {
      before: { present: changed.map((c) => ({ classId: c.classId, present: byClass.get(c.classId)?.present ?? null })) },
      after: { present: changed.map((c) => ({ classId: c.classId, present: c.present })) },
    });
    if (send) await emit(tx, 'mbg.count_ready', { schoolDate: day, correction: true });
    return day;
  });
  return mbgDaily(actor, date, now);
}
