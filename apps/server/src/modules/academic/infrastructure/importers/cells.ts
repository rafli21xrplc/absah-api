import type { CellValue } from 'exceljs';

/** Plain text of a cell, whatever exceljs made of it (rich text, formulas, links, numbers). */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('text' in value && typeof value.text === 'string') return value.text;
  if ('result' in value) return value.result === undefined ? '' : cellText(value.result);
  return '';
}

export const headerKey = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').replace(/[.:]/g, '').trim();

/** Digits of an identifier cell. Numbers lose leading zeros in Excel, so pad to the expected length. */
export function identifier(value: CellValue, length: number): { value: string | null; problem?: string } {
  if (value === null || value === undefined || cellText(value).trim() === '') return { value: null };
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return { value: null, problem: 'tersimpan sebagai angka sehingga digitnya tidak utuh; ubah kolom menjadi teks' };
    const digits = String(value);
    return digits.length <= length ? { value: digits.padStart(length, '0') } : { value: null, problem: `harus ${length} angka` };
  }
  const digits = cellText(value).replace(/^'/, '').replace(/[\s.-]/g, '');
  return new RegExp(`^\\d{${length}}$`).test(digits) ? { value: digits } : { value: null, problem: `harus ${length} angka` };
}

function validDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2030) return null;
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD from a date cell, "2013-05-14", "14/05/2013" or "14-05-2013". */
export function dateValue(value: CellValue): string | null {
  if (value instanceof Date) return validDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  const text = cellText(value).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) return validDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}
