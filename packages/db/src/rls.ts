import type pg from 'pg';

export interface RlsViolation {
  table: string;
  problem: 'rls_disabled' | 'no_policy' | 'app_role_bypasses_rls' | 'app_role_missing';
}

const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'drizzle', 'pgboss'];

/**
 * Every table with a school_id column (plus `schools` itself) must have RLS enabled and
 * at least one policy, and the app role must exist without BYPASSRLS.
 */
export async function findRlsViolations(client: pg.ClientBase | pg.Pool, appRole: string): Promise<RlsViolation[]> {
  const violations: RlsViolation[] = [];

  const role = await client.query<{ rolbypassrls: boolean }>(
    'select rolbypassrls from pg_roles where rolname = $1',
    [appRole],
  );
  const roleRow = role.rows[0];
  if (!roleRow) violations.push({ table: `role:${appRole}`, problem: 'app_role_missing' });
  else if (roleRow.rolbypassrls) violations.push({ table: `role:${appRole}`, problem: 'app_role_bypasses_rls' });

  const tables = await client.query<{ schema: string; table: string; rls: boolean; policies: string }>(
    `select n.nspname as schema, c.relname as table, c.relrowsecurity as rls,
            (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname <> all($1::text[])
        and n.nspname not like 'pg_%'
        and (exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'school_id' and not a.attisdropped)
             or (n.nspname = 'public' and c.relname = 'schools'))
      order by 1, 2`,
    [EXCLUDED_SCHEMAS],
  );

  for (const t of tables.rows) {
    const name = `${t.schema}.${t.table}`;
    if (!t.rls) violations.push({ table: name, problem: 'rls_disabled' });
    else if (Number(t.policies) === 0) violations.push({ table: name, problem: 'no_policy' });
  }
  return violations;
}
