import type { ClassStream } from '@absah/contracts';

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13,
};

const STREAMS: [RegExp, ClassStream][] = [
  [/\b(M?IPA|SAINTEK)\b/, 'ipa'],
  [/\b(IPS|IIS|SOSHUM)\b/, 'ips'],
  [/\b(BAHASA|BHS|IBB)\b/, 'bahasa'],
  [/\b(AGAMA|KEAGAMAAN|IIK)\b/, 'keagamaan'],
];

/**
 * Reads the grade (and SMA/MA stream) from a rombel name as schools write it in Dapodik:
 * "Kelas 7A", "7 A", "VII-A", "X IPA 1", "XII TKJ 2", "Kelas 1". null when there is no grade.
 */
export function parseClassName(name: string): { grade: number; stream: ClassStream | null } | null {
  const text = name.toUpperCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^KELAS\s*/, '');
  const arabic = /^(\d{1,2})(?=\D|$)/.exec(text);
  const roman = /^(XIII|XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)(?=[^A-Z]|$|[A-Z]\b)/.exec(text);
  const grade = arabic ? Number(arabic[1]) : roman?.[1] ? ROMAN[roman[1]] : undefined;
  if (grade === undefined || grade < 1 || grade > 13) return null;
  const stream = STREAMS.find(([re]) => re.test(text))?.[1] ?? null;
  return { grade, stream };
}
