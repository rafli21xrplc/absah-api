// Capability catalog, level presets and resolveCapabilities() land in prompt 1.4.
// See docs/architecture.md "Profil jenjang dan capability".

export const LEVELS = ['sd', 'smp', 'sma', 'smk'] as const;
export type Level = (typeof LEVELS)[number];

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}
