export const LEVELS = ['sd', 'smp', 'sma', 'smk'] as const;
export type Level = (typeof LEVELS)[number];

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}
