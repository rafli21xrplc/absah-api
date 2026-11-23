import {
  isCapabilityKey,
  parseCapabilityValue,
  presetCapabilities,
  type CapabilityKey,
  type CapabilityValue,
  type OverrideRow,
} from '@absah/capabilities';
import type {
  SchoolCapabilitiesResponse,
  SchoolProfileResponse,
  UpdateSchoolCapabilitiesRequest,
  UpdateSchoolProfileRequest,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { addDays, schoolDate } from '../../../shared/school-date';
import { describeSettings, pinsForProfileChange, planOverride } from '../domain/capability-settings';
import { canManageSchoolSettings } from '../domain/policies';
import { lockSchoolProfile, saveOverride, updateSchoolProfile as storeProfile } from '../infrastructure/school-settings-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

async function load(tx: Tx, schoolId: string) {
  const profile = await lockSchoolProfile(tx, schoolId);
  if (!profile) throw new NotFoundError('Sekolah tidak ditemukan.');
  const rows = await readCapabilityRows(tx);
  const today = schoolDate(profile.timezone);
  return { profile, rows, today, tomorrow: addDays(today, 1) };
}

async function settings(tx: Tx, schoolId: string): Promise<SchoolCapabilitiesResponse> {
  const { profile, rows, today } = await load(tx, schoolId);
  return { items: describeSettings(profile, rows, today, resolveFromRows(profile, rows, today)) };
}

export async function getSchoolCapabilities(actor: Actor): Promise<SchoolCapabilitiesResponse> {
  authorize(actor, canManageSchoolSettings);
  return withTenant(scope(actor), (tx) => settings(tx, actor.schoolId));
}

/**
 * Overrides capabilities. Keys must be in the catalog and values of the right kind; null goes
 * back to the preset. Keys under a kill switch cannot be changed. attendance.mode switches tomorrow.
 */
export async function updateSchoolCapabilities(
  actor: Actor,
  auditCtx: AuditContext,
  input: UpdateSchoolCapabilitiesRequest,
): Promise<SchoolCapabilitiesResponse> {
  authorize(actor, canManageSchoolSettings);
  const changes = validateValues(input.values);

  return withTenant(scope(actor), async (tx) => {
    const { profile, rows, today, tomorrow } = await load(tx, actor.schoolId);
    const preset = presetCapabilities(profile.level, profile.isMadrasah);
    const locked = changes.filter(([key]) => rows.flags.some((f) => f.key === key));
    if (locked.length > 0) {
      throw new ConflictError('Capability ini sedang dikunci oleh tim Absah.', { keys: locked.map(([k]) => k) });
    }

    const byKey = new Map<string, OverrideRow>(rows.overrides.map((r) => [r.key, r]));
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of changes) {
      const current = byKey.get(key);
      const plan = planOverride(key, current, value, preset[key], today, tomorrow);
      before[key] = current ? { value: current.value, previousValue: current.previousValue, effectiveFrom: current.effectiveFrom } : null;
      after[key] = plan;
      await saveOverride(tx, actor.schoolId, key, plan, actor.userId);
    }
    await audit(tx, auditCtx, 'school.capabilities_updated', { type: 'school', id: actor.schoolId }, { before, after });
    return settings(tx, actor.schoolId);
  });
}

function validateValues(values: Record<string, boolean | string | null>): [CapabilityKey, CapabilityValue | null][] {
  const issues: { path: string; message: string }[] = [];
  const changes: [CapabilityKey, CapabilityValue | null][] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!isCapabilityKey(key)) {
      issues.push({ path: `values.${key}`, message: 'Capability tidak dikenal.' });
      continue;
    }
    if (value === null) {
      changes.push([key, null]);
      continue;
    }
    const parsed = parseCapabilityValue(key, value);
    if (parsed.ok) changes.push([key, parsed.value]);
    else issues.push({ path: `values.${key}`, message: parsed.message });
  }
  if (issues.length > 0) throw new ValidationError(issues);
  return changes;
}

/**
 * Changes level / madrasah. Presets are re-applied, school overrides stay, and a deferred
 * capability that would switch today because of the preset is pinned until tomorrow.
 */
export async function updateSchoolProfile(
  actor: Actor,
  auditCtx: AuditContext,
  input: UpdateSchoolProfileRequest,
): Promise<SchoolProfileResponse> {
  authorize(actor, canManageSchoolSettings);

  return withTenant(scope(actor), async (tx) => {
    const { profile, rows, today, tomorrow } = await load(tx, actor.schoolId);
    const next = { level: input.level ?? profile.level, isMadrasah: input.isMadrasah ?? profile.isMadrasah };

    if (next.level !== profile.level || next.isMadrasah !== profile.isMadrasah) {
      const pins = pinsForProfileChange(
        resolveFromRows(profile, rows, today),
        resolveFromRows(next, rows, today),
        new Map(rows.overrides.map((r) => [r.key, r])),
        today,
        tomorrow,
      );
      await storeProfile(tx, actor.schoolId, next);
      for (const [key, plan] of pins) await saveOverride(tx, actor.schoolId, key, plan, actor.userId);
      await audit(tx, auditCtx, 'school.profile_updated', { type: 'school', id: actor.schoolId }, {
        before: { level: profile.level, isMadrasah: profile.isMadrasah },
        after: { ...next, pinned: Object.fromEntries(pins) },
      });
    }

    const after = await load(tx, actor.schoolId);
    return { ...next, capabilities: resolveFromRows(after.profile, after.rows, after.today) };
  });
}
