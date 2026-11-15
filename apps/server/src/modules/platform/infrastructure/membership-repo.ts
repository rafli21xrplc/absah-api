import { schema } from '@absah/db';
import type { Role } from '@absah/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { MembershipSummary } from '../../../shared/context';
import { withTenant, withUser } from '../../../shared/db';

/** Active memberships of one user across schools, grouped per school. Runs under withUser RLS. */
export async function listActiveMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        schoolId: schema.schools.id,
        schoolName: schema.schools.name,
        level: schema.schools.level,
        isMadrasah: schema.schools.isMadrasah,
        timezone: schema.schools.timezone,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .innerJoin(schema.schools, eq(schema.schools.id, schema.memberships.schoolId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')))
      .orderBy(schema.schools.name),
  );

  const bySchool = new Map<string, MembershipSummary>();
  for (const r of rows) {
    const entry = bySchool.get(r.schoolId) ?? {
      schoolId: r.schoolId,
      schoolName: r.schoolName,
      level: r.level,
      isMadrasah: r.isMadrasah,
      timezone: r.timezone,
      roles: [] as Role[],
    };
    if (!entry.roles.includes(r.role)) entry.roles.push(r.role);
    bySchool.set(r.schoolId, entry);
  }
  return [...bySchool.values()];
}

export interface SchoolMemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  status: 'active' | 'invited' | 'suspended';
  academicYearId: string | null;
}

/** Members of the active school via the school_member_directory view (migration 0003). */
export async function listSchoolMembers(ctx: { schoolId: string; userId: string }): Promise<SchoolMemberRow[]> {
  return withTenant(ctx, async (tx) => {
    const result = await tx.execute(sql`
      select membership_id as "membershipId", user_id as "userId", name,
             case when email like '%@phone.absah.invalid' then null else email end as email,
             role, status, academic_year_id as "academicYearId"
        from school_member_directory
       order by name, role`);
    return result.rows as unknown as SchoolMemberRow[];
  });
}
