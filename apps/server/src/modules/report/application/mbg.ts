import { maskPhone, MBG_DEFAULT_CUTOFF, type MbgDaily, type MbgSettings, type UpdateMbgSettingsRequest } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { clockLabel, countMbg, mbgTotal } from '../domain/mbg';
import { canManageMbg, canReadMbg } from '../domain/policies';
import { attendanceDay, currentCounts, cutoffRows, enrolledWithStatus, mbgClasses, mbgSettingsOf, saveMbgSettings, schoolTimezone } from '../infrastructure/mbg-repo';

const tenant = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function getMbgSettings(actor: Actor): Promise<MbgSettings> {
  authorize(actor, canReadMbg);
  return withTenant(tenant(actor), async (tx) => {
    const row = await mbgSettingsOf(tx);
    return {
      cutoffTime: clockLabel(row?.cutoffTime ?? MBG_DEFAULT_CUTOFF),
      picName: row?.picName ?? null,
      picPhone: row?.picPhone ? maskPhone(row.picPhone.reveal()) : null,
      updatedAt: iso(row?.updatedAt),
    };
  });
}

/** PUT /mbg/settings (admin). A new cutoff applies from the next day not counted yet. */
export async function updateMbgSettings(actor: Actor, auditCtx: AuditContext, input: UpdateMbgSettingsRequest, now = new Date()): Promise<MbgSettings> {
  authorize(actor, canManageMbg);
  await withTenant(tenant(actor), async (tx) => {
    const before = await mbgSettingsOf(tx);
    await saveMbgSettings(tx, actor.schoolId, { ...input, updatedBy: actor.userId }, now);
    const phoneBefore = before?.picPhone?.reveal() ?? null;
    // The number itself never goes to the audit log; only that it changed.
    await audit(tx, auditCtx, 'mbg.settings_updated', { type: 'mbg_settings', id: actor.schoolId }, {
      before: before ? { cutoffTime: clockLabel(before.cutoffTime), picName: before.picName, picPhoneSet: phoneBefore !== null } : null,
      after: { cutoffTime: input.cutoffTime, picName: input.picName, picPhoneSet: input.picPhone !== null, picPhoneChanged: phoneBefore !== input.picPhone },
    });
  });
  return getMbgSettings(actor);
}

/**
 * GET /mbg/daily: the stored numbers once the cutoff counted them (latest correction per rombel),
 * else live numbers from the day's rekap so far.
 */
export function mbgDaily(actor: Actor, date: string | undefined, now = new Date()): Promise<MbgDaily> {
  authorize(actor, canReadMbg);
  return withTenant(tenant(actor), async (tx) => {
    const day = date ?? schoolDate(await schoolTimezone(tx, actor.schoolId), now);
    const cutoffTime = clockLabel((await mbgSettingsOf(tx))?.cutoffTime ?? MBG_DEFAULT_CUTOFF);
    const stored = await currentCounts(tx, day);
    if (stored.length > 0) {
      const [first] = await cutoffRows(tx, day);
      const classes = stored.map((r) => ({ classId: r.classId, name: r.name, enrolled: r.enrolled, present: r.present, unrecorded: r.unrecorded, corrected: r.corrected !== null }));
      return { date: day, cutoffTime, status: 'counted', countedAt: iso(first?.createdAt), sentAt: iso(first?.sentAt), total: mbgTotal(classes), classes };
    }
    if ((await attendanceDay(tx, day))?.skippedReason) {
      return { date: day, cutoffTime, status: 'not_school_day', countedAt: null, sentAt: null, total: mbgTotal([]), classes: [] };
    }
    const classes = countMbg(await mbgClasses(tx), await enrolledWithStatus(tx, day)).map((r) => ({ ...r, corrected: false }));
    return { date: day, cutoffTime, status: 'pending', countedAt: null, sentAt: null, total: mbgTotal(classes), classes };
  });
}
