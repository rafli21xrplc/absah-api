// Reads the tables of a mysqldump file without a MySQL server: CREATE TABLE gives the column order,
// INSERT INTO ... VALUES (...),(...); gives the rows. Values come back as strings (numbers keep their
// text) or null. Enough for the default mysqldump output; not a general SQL parser.

export type DumpRow = Record<string, string | null>;
export type DumpTables = Map<string, DumpRow[]>;

/** Splits on `;` outside quotes and comments. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < sql.length && sql[i] !== c) i += sql[i] === '\\' && c !== '`' ? 2 : 1;
      i += 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      i = sql.indexOf('\n', i) === -1 ? sql.length : sql.indexOf('\n', i);
    } else if (c === '/' && sql[i + 1] === '*') {
      i = sql.indexOf('*/', i) === -1 ? sql.length : sql.indexOf('*/', i) + 2;
    } else if (c === ';') {
      out.push(sql.slice(start, i).trim());
      i += 1;
      start = i;
    } else i += 1;
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start).trim());
  return out.filter(Boolean);
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '').trim();
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', Z: '\x1a', b: '\b' };

/** "(1,'a\'b',NULL),(2,'c',3.5)" -> [['1',"a'b",null],['2','c','3.5']]. */
export function parseValues(text: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] | null = null;
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (c === '(' && !row) {
      row = [];
      i += 1;
    } else if (c === ')' && row) {
      rows.push(row);
      row = null;
      i += 1;
    } else if (!row || c === ',' || /\s/.test(c)) {
      i += 1;
    } else if (c === "'") {
      let value = '';
      i += 1;
      for (;;) {
        const ch = text[i];
        if (ch === undefined) break;
        if (ch === '\\') {
          const next = text[i + 1] ?? '';
          value += ESCAPES[next] ?? next;
          i += 2;
        } else if (ch === "'" && text[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (ch === "'") {
          i += 1;
          break;
        } else {
          value += ch;
          i += 1;
        }
      }
      row.push(value);
    } else {
      const end = text.slice(i).search(/[,)]/);
      const raw = text.slice(i, end === -1 ? text.length : i + end).trim();
      row.push(raw.toUpperCase() === 'NULL' ? null : raw);
      i += end === -1 ? text.length : end;
    }
  }
  return rows;
}

function createColumns(statement: string): [string, string[]] | null {
  const m = /^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(([\s\S]*)\)[^)]*$/i.exec(statement);
  if (!m?.[1] || m[2] === undefined) return null;
  const columns = m[2]
    .split('\n')
    .map((l) => /^\s*`(\w+)`\s/.exec(l)?.[1])
    .filter((c): c is string => c !== undefined);
  return [m[1], columns];
}

/** Rows of the wanted tables (all tables when `only` is empty). */
export function readDump(sql: string, only: readonly string[] = []): DumpTables {
  const columns = new Map<string, string[]>();
  const tables: DumpTables = new Map();
  for (const raw of statements(sql)) {
    const s = stripComments(raw);
    const created = createColumns(s);
    if (created) {
      columns.set(created[0], created[1]);
      continue;
    }
    const m = /^INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*)$/i.exec(s);
    if (!m?.[1] || m[3] === undefined) continue;
    const table = m[1];
    if (only.length && !only.includes(table)) continue;
    const names = m[2] ? m[2].split(',').map((n) => n.trim().replace(/`/g, '')) : columns.get(table);
    if (!names) throw new Error(`INSERT into ${table} without columns and without its CREATE TABLE`);
    const rows = tables.get(table) ?? [];
    for (const values of parseValues(m[3])) rows.push(Object.fromEntries(names.map((n, i) => [n, values[i] ?? null])));
    tables.set(table, rows);
  }
  return tables;
}
