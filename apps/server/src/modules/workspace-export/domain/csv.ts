/** A UTF-8 BOM so Excel opens Indonesian names correctly. */
export const CSV_BOM = '\uFEFF';

/**
 * One CSV cell. null is empty, dates are ISO, objects and arrays are JSON. Text that a spreadsheet would run as a formula
 * (starts with = @ tab, or + / - not followed by a digit) gets a leading apostrophe; numbers and "+62812…" stay as they are.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (Buffer.isBuffer(value)) text = `\\x${value.toString('hex')}`;
  else if (typeof value === 'object') text = JSON.stringify(value);
  else if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
  else text = '';
  if (typeof value === 'string' && /^[=@\t\r]|^[+-](?![\d.])/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
