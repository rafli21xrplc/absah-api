/**
 * Release flags: features built but not yet validated with partner schools. Off unless the Absah
 * team turns one on in platform_flags (value true; a per-school row beats the global row). They are
 * not capabilities: schools cannot switch them, and they disappear once the feature is released.
 */
export const RELEASE_FLAGS = ['rdm-export-beta'] as const;
export type ReleaseFlag = (typeof RELEASE_FLAGS)[number];

export const isReleaseFlag = (key: string): key is ReleaseFlag => (RELEASE_FLAGS as readonly string[]).includes(key);

/** Release flags of one school from its visible platform_flags rows; anything but true is off. */
export function releaseFlags(rows: readonly { key: string; value: unknown; schoolId: string | null }[]): Record<ReleaseFlag, boolean> {
  const out = Object.fromEntries(RELEASE_FLAGS.map((f) => [f, false])) as Record<ReleaseFlag, boolean>;
  for (const row of [...rows].sort((a, b) => Number(a.schoolId !== null) - Number(b.schoolId !== null))) {
    if (isReleaseFlag(row.key)) out[row.key] = row.value === true;
  }
  return out;
}
