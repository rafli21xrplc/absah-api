import {
  effectiveOverrides,
  killSwitches,
  resolveCapabilities,
  type BoolCapability,
  type CapabilityValues,
  type FlagRow,
  type InvalidCapabilityHandler,
  type Level,
  type OverrideRow,
} from '@absah/capabilities';
import { schema, type Tx } from '@absah/db';
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

/** Override and kill-switch rows visible to the current withTenant transaction. */
export async function readCapabilityRows(tx: Tx): Promise<{ overrides: OverrideRow[]; flags: FlagRow[] }> {
  return {
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
  };
}

/** All five layers for one school on `today`. */
export function resolveFromRows(
  profile: Pick<SchoolProfile, 'level' | 'isMadrasah'>,
  rows: { overrides: OverrideRow[]; flags: FlagRow[] },
  today: string,
  onInvalid?: InvalidCapabilityHandler,
): CapabilityValues {
  return resolveCapabilities({
    level: profile.level,
    isMadrasah: profile.isMadrasah,
    overrides: effectiveOverrides(rows.overrides, today, onInvalid),
    killSwitches: killSwitches(rows.flags, onInvalid),
  });
}

/** Resolves the capabilities of the active school (once per request, from resolveContext). */
export async function loadCapabilities(
  ctx: { schoolId: string; userId: string | null },
  profile: SchoolProfile,
  logger?: Logger,
): Promise<CapabilityValues> {
  const rows = await withTenant(ctx, readCapabilityRows);
  // A stored key or value the catalog no longer accepts is ignored, never fatal.
  const onInvalid: InvalidCapabilityHandler = (key, source) =>
    logger?.warn({ key, source, schoolId: ctx.schoolId }, 'invalid capability ignored');
  return resolveFromRows(profile, rows, schoolDate(profile.timezone), onInvalid);
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
