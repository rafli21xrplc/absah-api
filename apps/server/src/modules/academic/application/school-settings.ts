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
import { isUniqueViolation } from '../../../shared/pg-errors';
import { addDays, schoolDate } from '../../../shared/school-date';
import { describeSettings, pinsForProfileChange, planOverride, type OverridePlan } from '../domain/capability-settings';
import { canManageSchoolSettings } from '../domain/policies';
import {
  lockSchoolProfile,
  readSetup,
  saveOverride,
  updateSchoolProfile as storeProfile,
  type StoredProfile,
} from '../infrastructure/school-settings-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

async function load(tx: Tx, schoolId: string) {
  const profile = await lockSchoolProfile(tx, schoolId);
  if (!profile) throw new NotFoundError('Sekolah tidak ditemukan.');
  const rows = await readCapabilityRows(tx);
  const today = schoolDate(profile.timezone);
  // Deferred capabilities only wait for tomorrow once the school runs (setup finished).
  const setup = await readSetup(tx, schoolId);
  return { profile, rows, today, tomorrow: setup?.completedAt ? addDays(today, 1) : null };
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
 * Updates the school profile. Identity fields (name, NPSN/NSM, timezone) change as given.
 * A level/madrasah change re-applies presets, keeps school overrides, and pins a deferred
 * capability that would switch today because of the preset until tomorrow.
 */
export async function updateSchoolProfile(
  actor: Actor,
  auditCtx: AuditContext,
  input: UpdateSchoolProfileRequest,
): Promise<SchoolProfileResponse> {
  authorize(actor, canManageSchoolSettings);

  try {
    return await withTenant(scope(actor), async (tx) => {
      const { profile, rows, today, tomorrow } = await load(tx, actor.schoolId);
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<StoredProfile>;
      const next: StoredProfile = { ...profile, ...patch };
      const changed = (Object.keys(patch) as (keyof StoredProfile)[]).filter((k) => profile[k] !== next[k]);

      let pins = new Map<CapabilityKey, NonNullable<OverridePlan>>();
      if (changed.length > 0) {
        if (next.level !== profile.level || next.isMadrasah !== profile.isMadrasah) {
          pins = pinsForProfileChange(
            resolveFromRows(profile, rows, today),
            resolveFromRows(next, rows, today),
            new Map(rows.overrides.map((r) => [r.key, r])),
            today,
            tomorrow,
          );
          for (const [key, plan] of pins) {
            await saveOverride(tx, actor.schoolId, key, plan, actor.userId);
          }
        }
        await storeProfile(tx, actor.schoolId, patch);
        await audit(tx, auditCtx, 'school.profile_updated', { type: 'school', id: actor.schoolId }, {
          before: pick(profile, changed),
          after: { ...pick(next, changed), ...(pins.size > 0 ? { pinned: Object.fromEntries(pins) } : {}) },
        });
      }

      const after = await load(tx, actor.schoolId);
      return { ...after.profile, capabilities: resolveFromRows(after.profile, after.rows, after.today) };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'schools_npsn_key')) throw new ConflictError('NPSN sudah dipakai sekolah lain.');
    if (isUniqueViolation(err, 'schools_nsm_key')) throw new ConflictError('NSM sudah dipakai sekolah lain.');
    throw err;
  }
}

function pick(profile: StoredProfile, keys: (keyof StoredProfile)[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, profile[k]]));
}
