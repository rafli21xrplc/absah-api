import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  DEFERRED_CAPABILITIES,
  effectiveOverrides,
  killSwitches,
  overrideToday,
  presetCapabilities,
  type CapabilityKey,
  type CapabilityValue,
  type CapabilityValues,
  type FlagRow,
  type Level,
  type OverrideRow,
} from '@absah/capabilities';
import type { CapabilitySetting } from '@absah/contracts';

/** What to store for one key: a row (upsert) or null (delete the override). */
export type OverridePlan = Pick<OverrideRow, 'value' | 'previousValue' | 'effectiveFrom'> | null;

const isDeferred = (key: CapabilityKey) => DEFERRED_CAPABILITIES.includes(key);

/**
 * Plans an override change. `tomorrow` null means nothing is deferred: the school is still in its
 * setup wizard, so no attendance session exists that a same-day switch could disturb.
 * Immediate keys change now. Deferred keys keep today's value in
 * previous_value and switch tomorrow; asking for the value already in force today (override or
 * preset) cancels a pending change instead.
 */
export function planOverride(
  key: CapabilityKey,
  current: OverrideRow | undefined,
  next: CapabilityValue | null,
  preset: CapabilityValue,
  today: string,
  tomorrow: string | null,
): OverridePlan {
  const immediate = next === null ? null : { value: next, previousValue: null, effectiveFrom: null };
  if (!isDeferred(key) || tomorrow === null) return immediate;
  const now = overrideToday(current, today) ?? null;
  if ((next ?? preset) === (now ?? preset)) return immediate;
  return { value: next, previousValue: now, effectiveFrom: tomorrow };
}

/**
 * A profile change must not switch a deferred capability today when the switch comes from the
 * preset (no override in force). Returns the rows that pin today's value until tomorrow.
 */
export function pinsForProfileChange(
  before: CapabilityValues,
  after: CapabilityValues,
  rows: Map<string, OverrideRow>,
  today: string,
  tomorrow: string | null,
): Map<CapabilityKey, NonNullable<OverridePlan>> {
  const pins = new Map<CapabilityKey, NonNullable<OverridePlan>>();
  if (tomorrow === null) return pins; // setup in progress: the new preset applies at once
  for (const key of DEFERRED_CAPABILITIES) {
    if (before[key] === after[key]) continue;
    const row = rows.get(key);
    if (overrideToday(row, today) !== null) continue; // an override decides, the preset does not matter
    const pending = row && row.effectiveFrom !== null && row.effectiveFrom > today;
    pins.set(
      key,
      pending
        ? { value: row.value, previousValue: before[key], effectiveFrom: row.effectiveFrom }
        : { value: null, previousValue: before[key], effectiveFrom: tomorrow },
    );
  }
  return pins;
}

/** Rows of the settings screen. */
export function describeSettings(
  profile: { level: Level; isMadrasah: boolean },
  rows: { overrides: OverrideRow[]; flags: FlagRow[] },
  today: string,
  effective: CapabilityValues,
): CapabilitySetting[] {
  const preset = presetCapabilities(profile.level, profile.isMadrasah);
  const overrides = effectiveOverrides(rows.overrides, today);
  const kills = killSwitches(rows.flags);
  const byKey = new Map(rows.overrides.map((r) => [r.key, r]));
  return CAPABILITY_KEYS.map((key) => {
    const def = CAPABILITIES[key];
    const row = byKey.get(key);
    const pending = row && row.effectiveFrom !== null && row.effectiveFrom > today;
    return {
      key,
      kind: def.kind,
      options: def.kind === 'enum' ? [...def.values] : null,
      preset: preset[key],
      override: overrides[key] ?? null,
      pending: pending ? { value: (row.value ?? null) as CapabilityValue | null, effectiveFrom: row.effectiveFrom ?? '' } : null,
      killSwitch: kills[key] ?? null,
      deferred: isDeferred(key),
      effective: effective[key],
    };
  });
}
