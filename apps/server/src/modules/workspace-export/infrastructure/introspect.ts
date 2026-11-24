import type { Tx } from '@absah/db';
import { sql } from 'drizzle-orm';

export interface TableRef {
  schema: string;
  table: string;
}

/** Every table of the default and tppk schemas with a school_id column, plus the school's own row (RLS limits both to this school). */
export async function tenantTables(tx: Tx): Promise<TableRef[]> {
  const res = await tx.execute<{ schema: string; table: string }>(sql`
    select n.nspname as schema, c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname in ('public', 'tppk')
       and (c.relname = 'schools' and n.nspname = 'public'
            or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'school_id' and not a.attisdropped))
     order by 1, 2`);
  return res.rows;
}

export async function columnsOf(tx: Tx, ref: TableRef): Promise<string[]> {
  const res = await tx.execute<{ name: string }>(sql`
    select a.attname as name
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${ref.schema} and c.relname = ${ref.table} and a.attnum > 0 and not a.attisdropped
     order by a.attnum`);
  return res.rows.map((r) => r.name);
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** All rows of a table in batches through a cursor, so a large table never sits in memory twice. Identifiers come from the catalog. */
export async function* rowsOf(tx: Tx, ref: TableRef, columns: string[], batch = 2000): AsyncGenerator<Record<string, unknown>[]> {
  const cursor = `export_${Math.random().toString(36).slice(2, 10)}`;
  const list = columns.map(quote).join(', ');
  await tx.execute(sql.raw(`declare ${cursor} no scroll cursor for select ${list} from ${quote(ref.schema)}.${quote(ref.table)}`));
  try {
    for (;;) {
      const res = await tx.execute<Record<string, unknown>>(sql.raw(`fetch ${batch} from ${cursor}`));
      if (res.rows.length === 0) return;
      yield res.rows;
    }
  } finally {
    await tx.execute(sql.raw(`close ${cursor}`));
  }
}

/** The ids and storage keys of one column's files (rows whose key is set). */
export async function storageKeysOf(tx: Tx, table: string, column: string): Promise<{ id: string; key: string }[]> {
  const res = await tx.execute<{ id: string; key: string }>(sql.raw(`select id::text as id, ${quote(column)} as key from ${quote('public')}.${quote(table)} where ${quote(column)} is not null order by id`));
  return res.rows;
}

/** Columns named like a storage key in the default schema, to check the registry against the schema. */
export async function storageKeyColumns(tx: Tx): Promise<{ table: string; column: string }[]> {
  const res = await tx.execute<{ table: string; column: string }>(sql`
    select table_name as table, column_name as column from information_schema.columns
     where table_schema = 'public' and column_name ~ '(file|photo|attachment|evidence)_key$'
     order by 1, 2`);
  return res.rows;
}
