import type { Level } from '@absah/capabilities';
import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import type { Auth } from '../infrastructure/auth';
import { insertInvitedMembership, issueInvitation } from '../infrastructure/invitation-repo';
import { createStaffUser, findUserByEmail } from '../infrastructure/users';

/**
 * Ops path (Absah team): creates a school and invites its first admin, who then runs the setup
 * wizard. The level is provisional; the admin confirms it in wizard step 2.
 */
export async function createSchoolWithAdmin(
  auth: Auth,
  input: { schoolName: string; level?: Level; adminName: string; adminEmail: string },
  appUrl: string,
): Promise<{ schoolId: string; adminUserId: string; inviteUrl: string }> {
  const email = input.adminEmail.toLowerCase();
  const adminUserId =
    (await findUserByEmail(auth, email))?.id ?? (await createStaffUser(auth, { name: input.adminName, email })).id;
  const schoolId = uuidv7();

  // The new school id is the tenant, so RLS (WITH CHECK id = app.school_id) allows the insert.
  return withTenant({ schoolId, userId: null }, async (tx) => {
    await tx.insert(schema.schools).values({ id: schoolId, name: input.schoolName, level: input.level ?? 'sma' });
    const membershipId = await insertInvitedMembership(tx, schoolId, adminUserId, 'admin');
    const invitation = await issueInvitation(tx, { schoolId, membershipId, createdBy: null });
    await audit(
      tx,
      { schoolId, actorUserId: null, requestId: null, ip: null },
      'school.created',
      { type: 'school', id: schoolId },
      { after: { level: input.level ?? 'sma', adminMembershipId: membershipId } },
    );
    return { schoolId, adminUserId, inviteUrl: `${appUrl.replace(/\/$/, '')}/undangan#${invitation.token}` };
  });
}
