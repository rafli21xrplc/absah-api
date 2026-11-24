import { getTableName, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Name of a member of the active school (school_member_directory), for a user-id column of the table being selected.
 * The column is written qualified on purpose: Drizzle renders a column of a single-table select WITHOUT its table, and
 * inside the subquery a bare "user_id" resolves to the directory's own column (d.user_id = d.user_id), which returns
 * an arbitrary member's name for every row.
 */
export function directoryName(column: AnyColumn): SQL<string | null> {
  const qualified = sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
  return sql<string | null>`(select d.name from school_member_directory d where d.user_id = ${qualified} limit 1)`;
}
