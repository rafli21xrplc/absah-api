import type { Gender, GuardianRelation } from '@absah/contracts';

/**
 * What a student importer (Dapodik now, EMIS later) produces from an uploaded file. Only the fields
 * Absah needs are read; addresses, incomes and the like stay in the file (data minimisation).
 */
export interface ImportedGuardian {
  relation: GuardianRelation;
  name: string;
}

export interface ImportedStudent {
  /** 1-based spreadsheet row, for messages staff can find in the file. */
  row: number;
  name: string;
  nisn: string | null;
  nik: string | null;
  localId: string | null;
  gender: Gender | null;
  birthPlace: string | null;
  /** YYYY-MM-DD */
  birthDate: string | null;
  className: string | null;
  guardians: ImportedGuardian[];
}

export interface ImportIssue {
  row: number;
  field?: string;
  message: string;
  /** error = the row is skipped; warning = the row is imported without that field. */
  severity: 'error' | 'warning';
}

export interface ParsedImport {
  rows: ImportedStudent[];
  issues: ImportIssue[];
}

export type ImportSource = 'dapodik' | 'emis';

/** Turns an export file into rows. Throws ImportFormatError when the file is not a valid export. */
export interface StudentImporter {
  readonly source: ImportSource;
  parse(file: Uint8Array): Promise<ParsedImport>;
}

/** The file is not the expected export (wrong file, missing columns). Message is shown to staff. */
export class ImportFormatError extends Error {
  override readonly name = 'ImportFormatError';
}

/** Upper-case, single spaces, letters/digits/apostrophes only: for matching, not for display. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trims and collapses whitespace, keeping the spelling from the file. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Shows only the last 4 digits of a NIK in previews. */
export function maskNik(nik: string): string {
  return `••••••••••••${nik.slice(-4)}`;
}
