import { SensitiveText } from '@absah/db';
import { SENSITIVE_KEYS } from './sensitive-keys';

const SENSITIVE = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));
const MAX_STRING = 200;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
export const MAX_DIFF_BYTES = 4096;

/**
 * "before/after jsonb terbatas": keeps audit diffs useful but small and free of personal data.
 * Sensitive keys and encrypted values become "[redacted]", long strings and arrays are cut, and an
 * oversized result is replaced by its top-level keys.
 */
export function sanitizeDiff(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const cleaned = clean(value, 0);
  const size = Buffer.byteLength(JSON.stringify(cleaned) ?? 'null');
  if (size <= MAX_DIFF_BYTES) return cleaned;
  return {
    _truncated: true,
    keys: typeof cleaned === 'object' && cleaned !== null ? Object.keys(cleaned).slice(0, 50) : [],
  };
}

function clean(value: unknown, depth: number): unknown {
  if (value instanceof SensitiveText) return '[redacted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return undefined; // functions, symbols, undefined
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => clean(v, depth + 1));
    return value.length > MAX_ARRAY ? [...items, `[+${value.length - MAX_ARRAY} more]`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const c = SENSITIVE.has(k.toLowerCase()) ? '[redacted]' : clean(v, depth + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}
