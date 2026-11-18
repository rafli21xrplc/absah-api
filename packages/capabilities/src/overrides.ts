import { isCapabilityKey, parseCapabilityValue, type CapabilityValues } from './catalog';
import { isReleaseFlag } from './release';

/**
 * Stored school override (school_capabilities). A deferred change keeps previous_value in force
 * until effective_from (a school date, YYYY-MM-DD). value null = no override (use the preset).
 */
export interface OverrideRow {
  key: string;
  value: unknown;
  previousValue: unknown;
  effectiveFrom: string | null;
}

/** Stored kill switch (platform_flags); schoolId null = every school. */
export interface FlagRow {
  key: string;
  value: unknown;
  schoolId: string | null;
}

export type InvalidCapabilityHandler = (key: string, source: 'override' | 'kill_switch') => void;

/** The stored override value in force on `today` (null = preset). */
export function overrideToday(row: OverrideRow | undefined, today: string): unknown {
  if (!row) return null;
  return row.effectiveFrom === null || row.effectiveFrom <= today ? row.value : row.previousValue;
}

/** Overrides in force on `today`. Keys or values the catalog rejects are skipped and reported. */
export function effectiveOverrides(
  rows: OverrideRow[],
  today: string,
  onInvalid: InvalidCapabilityHandler = () => {},
): Partial<CapabilityValues> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const value = overrideToday(row, today);
    if (value === null || value === undefined) continue;
    if (!isCapabilityKey(row.key) || !parseCapabilityValue(row.key, value).ok) {
      onInvalid(row.key, 'override');
      continue;
    }
    out[row.key] = value;
  }
  return out;
}

/** Kill switches: global rows first, then the school's own rows win. */
export function killSwitches(rows: FlagRow[], onInvalid: InvalidCapabilityHandler = () => {}): Partial<CapabilityValues> {
  const out: Record<string, unknown> = {};
  for (const row of [...rows].sort((a, b) => Number(a.schoolId !== null) - Number(b.schoolId !== null))) {
    if (isReleaseFlag(row.key)) continue; // release flags share the table, read by releaseFlags()
    if (!isCapabilityKey(row.key) || !parseCapabilityValue(row.key, row.value).ok) {
      onInvalid(row.key, 'kill_switch');
      continue;
    }
    out[row.key] = row.value;
  }
  return out;
}
