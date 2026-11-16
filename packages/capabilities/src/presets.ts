import { CAPABILITIES, CAPABILITY_KEYS, type CapabilityKey, type CapabilityValues } from './catalog';
import type { Level } from './levels';

/** Differences from the global defaults per level. Never put behaviour here, only values. */
export const LEVEL_PRESETS = {
  sd: { 'attendance.mode': 'daily', 'card.holder': 'parent', 'gate.pickup': true, 'habits.kaih': 'parent' },
  smp: { 'habits.kaih': 'student' },
  sma: { 'attendance.learningGroups': true, 'academic.streams': true },
  smk: { 'attendance.learningGroups': true, 'pkl.enabled': true, 'pkl.tracer': true },
} as const satisfies Record<Level, Partial<CapabilityValues>>;

/** Applied on top of the level preset for MI, MTs, MA and MAK. */
export const MADRASAH_OVERLAY = {
  'data.source': 'emis',
  'report.target': 'rdm',
  'religious.worship': true,
  'religious.memorization': true,
} as const satisfies Partial<CapabilityValues>;

/** Layer 1: global defaults from the catalog. */
export function defaultCapabilities(): CapabilityValues {
  const out: Partial<Record<CapabilityKey, unknown>> = {};
  for (const key of CAPABILITY_KEYS) out[key] = CAPABILITIES[key].default;
  return out as CapabilityValues;
}

/** Layers 1-3: what a school gets from its profile alone (shown as "bawaan" in settings). */
export function presetCapabilities(level: Level, isMadrasah: boolean): CapabilityValues {
  return { ...defaultCapabilities(), ...LEVEL_PRESETS[level], ...(isMadrasah ? MADRASAH_OVERLAY : {}) };
}

/**
 * Resolution order, later layers win (docs/architecture.md "Profil jenjang dan capability"):
 * defaults < level preset < madrasah overlay < school overrides < platform kill switches.
 * Callers must pass already-validated overrides and kill switches.
 */
export function resolveCapabilities(input: {
  level: Level;
  isMadrasah: boolean;
  overrides?: Partial<CapabilityValues>;
  killSwitches?: Partial<CapabilityValues>;
}): CapabilityValues {
  return {
    ...presetCapabilities(input.level, input.isMadrasah),
    ...input.overrides,
    ...input.killSwitches,
  };
}
