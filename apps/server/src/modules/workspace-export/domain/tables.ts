/**
 * Which tables and files the workspace export carries (PLT-11). Every table with a school_id is exported unless it is listed
 * here: secrets, queues and the Absah team's own switches are not the school's data. Columns ending in _hash or secret are
 * left out (blind indexes of values that are exported decrypted, IP hashes). Encrypted columns are exported decrypted: it is
 * the school's own data and the admin asked for it; the export reads with the requester's own rights (RLS), so counseling
 * notes and the tppk schema show exactly what that person may read.
 */
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  'public.action_links', // one-time link secrets
  'public.gate_secrets', // card signing secret
  'public.idempotency_keys',
  'public.invitations', // token hashes
  'public.kiosk_devices', // device token hashes
  'public.kiosk_pairings',
  'public.outbox_consumptions',
  'public.outbox_events',
  'public.platform_flags', // the Absah team's release switches
  'public.push_subscriptions', // browser push keys
  'public.export_jobs', // temporary rekap files, not data
  'public.workspace_exports',
]);

/** Schemas read: the default one, and tppk only when the requester is on the TPPK team. */
export const TPPK_SCHEMA = 'tppk';

export function isExportedTable(schema: string, table: string, includeTppk: boolean): boolean {
  if (schema === TPPK_SCHEMA) return includeTppk;
  return !EXCLUDED_TABLES.has(`${schema}.${table}`);
}

export const omitColumn = (column: string): boolean => /(_hash|secret)$/.test(column);

export const tableEntryName = (schema: string, table: string): string => (schema === 'public' ? `tabel/${table}.csv` : `tabel/${schema}/${table}.csv`);

/** Columns holding an object-storage key of a file the school uploaded. */
export const STORAGE_COLUMNS: readonly { table: string; column: string }[] = [
  { table: 'student_imports', column: 'file_key' },
  { table: 'visitors', column: 'photo_key' },
  { table: 'pickup_guardians', column: 'photo_key' },
  { table: 'pickup_events', column: 'unlisted_photo_key' },
  { table: 'leave_requests', column: 'attachment_key' },
  { table: 'pkl_journals', column: 'attachment_key' },
  { table: 'point_entries', column: 'evidence_key' },
];

/** Storage columns that are deliberately not exported: temporary files that are not the school's data. */
export const IGNORED_STORAGE_COLUMNS: readonly { table: string; column: string }[] = [{ table: 'export_jobs', column: 'file_key' }, { table: 'workspace_exports', column: 'file_key' }];

/** "schools/{school}/{module}/{uuid}" -> "berkas/{module}/{uuid}" (the original name is not kept anywhere, the type is not either). */
export function fileEntryName(key: string): string {
  const [, , module = 'lain', name = key] = key.split('/');
  return `berkas/${module}/${name}`;
}

/** Ciphertext format of column encryption: v1:<keyId>:<iv>:<tag>:<data>. */
export const looksEncrypted = (value: unknown): value is string => typeof value === 'string' && /^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$/.test(value);

/** The AAD the column was encrypted with: "<table>.<column>", "tppk.<table>.<column>" in the tppk schema. */
export const encryptionContext = (schema: string, table: string, column: string): string => (schema === 'public' ? `${table}.${column}` : `${schema}.${table}.${column}`);

/** Files beyond this many bytes are listed as skipped instead of added: the archive is built in memory. */
export const MAX_FILE_BYTES_TOTAL = 400 * 1024 * 1024;
