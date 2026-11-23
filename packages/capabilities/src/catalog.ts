/**
 * Every capability the product knows. Code reads capabilities, never the school level
 * (CLAUDE.md rule 4). Adding a key: add it here with a safe default; level presets and the
 * madrasah overlay only list differences. Removing or renaming a key needs a data migration of
 * school_capabilities and platform_flags.
 */
export const CAPABILITIES = {
  'attendance.mode': { kind: 'enum', values: ['per_period', 'daily'], default: 'per_period' },
  'attendance.learningGroups': { kind: 'bool', default: false },
  'gate.enabled': { kind: 'bool', default: false },
  'gate.pickup': { kind: 'bool', default: false },
  'gate.visitors': { kind: 'bool', default: true },
  'card.holder': { kind: 'enum', values: ['student', 'parent'], default: 'student' },
  'habits.kaih': { kind: 'enum', values: ['off', 'parent', 'student'], default: 'off' },
  'religious.worship': { kind: 'bool', default: false },
  'religious.memorization': { kind: 'bool', default: false },
  'academic.streams': { kind: 'bool', default: false },
  'pkl.enabled': { kind: 'bool', default: false },
  'pkl.tracer': { kind: 'bool', default: false },
  'mbg.enabled': { kind: 'bool', default: false },
  'student.tppk': { kind: 'bool', default: true },
  'student.uks': { kind: 'bool', default: true },
  'student.points': { kind: 'bool', default: true },
  'student.counseling': { kind: 'bool', default: true },
  'student.early_warning': { kind: 'bool', default: true },
  'teacher.attendance': { kind: 'bool', default: true },
  'portal.liaison': { kind: 'bool', default: true },
  'data.source': { kind: 'enum', values: ['dapodik', 'emis'], default: 'dapodik' },
  'report.target': { kind: 'enum', values: ['erapor', 'rdm'], default: 'erapor' },
} as const satisfies Record<string, CapabilityDef>;

export type CapabilityDef =
  | { kind: 'bool'; default: boolean }
  | { kind: 'enum'; values: readonly [string, ...string[]]; default: string };

type Catalog = typeof CAPABILITIES;
export type CapabilityKey = keyof Catalog;

type ValueOf<D> = D extends { kind: 'enum'; values: readonly (infer V)[] } ? V : boolean;
export type CapabilityValues = { [K in CapabilityKey]: ValueOf<Catalog[K]> };
export type CapabilityValue = CapabilityValues[CapabilityKey];

/** Keys usable with requireCap / <IfCap>. */
export type BoolCapability = { [K in CapabilityKey]: Catalog[K]['kind'] extends 'bool' ? K : never }[CapabilityKey];

/** Changes to these keys take effect the next school day (attendance sessions of today stay). */
export const DEFERRED_CAPABILITIES: readonly CapabilityKey[] = ['attendance.mode'];

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];

export function isCapabilityKey(key: unknown): key is CapabilityKey {
  return typeof key === 'string' && Object.hasOwn(CAPABILITIES, key);
}

export function isBoolCapability(key: unknown): key is BoolCapability {
  return isCapabilityKey(key) && CAPABILITIES[key].kind === 'bool';
}

/** Checks a value against its key's kind. Returns the typed value or an Indonesian error message. */
export function parseCapabilityValue<K extends CapabilityKey>(
  key: K,
  value: unknown,
): { ok: true; value: CapabilityValues[K] } | { ok: false; message: string } {
  const def: CapabilityDef = CAPABILITIES[key];
  if (def.kind === 'bool') {
    return typeof value === 'boolean'
      ? { ok: true, value: value as CapabilityValues[K] }
      : { ok: false, message: 'Nilai harus true atau false.' };
  }
  return typeof value === 'string' && def.values.includes(value)
    ? { ok: true, value: value as CapabilityValues[K] }
    : { ok: false, message: `Nilai harus salah satu dari: ${def.values.join(', ')}.` };
}
