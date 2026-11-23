import {
  isCapabilityKey,
  parseCapabilityValue,
  resolveCapabilities,
  type BoolCapability,
  type CapabilityValues,
  type Level,
} from '@absah/capabilities';
import { schema } from '@absah/db';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { getCtx } from './context';
import { withTenant } from './db';
import { CapabilityDisabledError } from './errors';
import { schoolDate } from './school-date';

export interface SchoolProfile {
  level: Level;
  isMadrasah: boolean;
  timezone: string;
}

export interface OverrideRow {
  key: string;
  value: unknown;
  previousValue: unknown;
  effectiveFrom: string | null;
}

export interface FlagRow {
  key: string;
  value: unknown;
  schoolId: string | null;
}

type Invalid = (key: string, source: 'override' | 'kill_switch') => void;

/** The override in force on `today` per key (deferred rows keep previous_value until then). */
export function effectiveOverrides(rows: OverrideRow[], today: string, onInvalid: Invalid = () => {}) {
  const out: Partial<Record<keyof CapabilityValues, unknown>> = {};
  for (const row of rows) {
    const value = row.effectiveFrom === null || row.effectiveFrom <= today ? row.value : row.previousValue;
    if (value === null || value === undefined) continue;
    if (!isCapabilityKey(row.key) || !parseCapabilityValue(row.key, value).ok) {
      onInvalid(row.key, 'override');
      continue;
    }
    out[row.key] = value;
  }
  return out as Partial<CapabilityValues>;
}

/** Kill switches: global rows first, then the school's own rows win. */
export function killSwitches(rows: FlagRow[], onInvalid: Invalid = () => {}) {
  const out: Partial<Record<keyof CapabilityValues, unknown>> = {};
  for (const row of [...rows].sort((a, b) => Number(a.schoolId !== null) - Number(b.schoolId !== null))) {
    if (!isCapabilityKey(row.key) || !parseCapabilityValue(row.key, row.value).ok) {
      onInvalid(row.key, 'kill_switch');
      continue;
    }
    out[row.key] = row.value;
  }
  return out as Partial<CapabilityValues>;
}

/** Resolves the capabilities of the active school (once per request, from resolveContext). */
export async function loadCapabilities(
  ctx: { schoolId: string; userId: string | null },
  profile: SchoolProfile,
  logger?: Logger,
): Promise<CapabilityValues> {
  const { overrides, flags } = await withTenant(ctx, async (tx) => ({
    overrides: await tx
      .select({
        key: schema.schoolCapabilities.key,
        value: schema.schoolCapabilities.value,
        previousValue: schema.schoolCapabilities.previousValue,
        effectiveFrom: schema.schoolCapabilities.effectiveFrom,
      })
      .from(schema.schoolCapabilities),
    flags: await tx
      .select({ key: schema.platformFlags.key, value: schema.platformFlags.value, schoolId: schema.platformFlags.schoolId })
      .from(schema.platformFlags),
  }));
  // A stored key or value the catalog no longer accepts is ignored, never fatal.
  const onInvalid: Invalid = (key, source) => logger?.warn({ key, source, schoolId: ctx.schoolId }, 'invalid capability ignored');
  return resolveCapabilities({
    level: profile.level,
    isMadrasah: profile.isMadrasah,
    overrides: effectiveOverrides(overrides, schoolDate(profile.timezone), onInvalid),
    killSwitches: killSwitches(flags, onInvalid),
  });
}

/**
 * Guards a route behind a boolean capability. Mount after resolveContext({ school: 'required' }).
 * Disabled answers 404 CAPABILITY_DISABLED, so clients cannot probe a school's feature set.
 */
export function requireCap(key: BoolCapability): RequestHandler {
  return (req, _res, next) => {
    next(getCtx(req).caps[key] === true ? undefined : new CapabilityDisabledError(key));
  };
}
