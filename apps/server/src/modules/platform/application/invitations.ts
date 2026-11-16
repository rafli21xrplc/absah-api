import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  InvitationPreviewResponse,
  InvitationResponse,
} from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { canInviteMembers } from '../domain/policies';
import type { Auth } from '../infrastructure/auth';
import {
  findMembership,
  findOpenInvitation,
  insertInvitedMembership,
  issueInvitation,
  markAccepted,
  parseInvitationToken,
} from '../infrastructure/invitation-repo';
import {
  createPhoneUser,
  createStaffUser,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  hasPassword,
  isPhoneOnlyEmail,
  setInitialPassword,
} from '../infrastructure/users';

/**
 * Invites a staff member (PLT-12). Reuses an existing account with the same email or WhatsApp
 * number, creates an invited membership (or refreshes the link of a pending one) and returns the
 * link once. The membership becomes active when the invitee accepts.
 */
export async function inviteMember(
  auth: Auth,
  actor: Actor,
  auditCtx: AuditContext,
  input: CreateInvitationRequest,
  appUrl: string,
): Promise<InvitationResponse> {
  authorize(actor, canInviteMembers);

  const existing = input.email ? await findUserByEmail(auth, input.email) : await findUserByPhone(auth, input.phoneNumber ?? '');
  const userId =
    existing?.id ??
    (input.email
      ? (await createStaffUser(auth, { name: input.name, email: input.email })).id
      : (await createPhoneUser(auth, { name: input.name, phoneNumber: input.phoneNumber ?? '' })).id);

  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const membership = await findMembership(tx, actor.schoolId, userId, input.role);
    if (membership?.status === 'active') throw new ConflictError('Orang ini sudah menjadi anggota dengan peran tersebut.');
    if (membership?.status === 'suspended') {
      throw new ConflictError('Keanggotaan ini ditangguhkan. Aktifkan kembali dari daftar anggota.');
    }
    const membershipId = membership?.id ?? (await insertInvitedMembership(tx, actor.schoolId, userId, input.role));
    const invitation = await issueInvitation(tx, { schoolId: actor.schoolId, membershipId, createdBy: actor.userId });

    const channel = input.email ? 'email' : 'whatsapp';
    await audit(tx, auditCtx, 'membership.invited', { type: 'membership', id: membershipId }, {
      after: { role: input.role, channel, reissued: Boolean(membership) },
    });
    await emit(tx, 'membership.invited', { membershipId, invitationId: invitation.id, channel });

    return {
      membershipId,
      role: input.role,
      // Fragment, not query: the token never reaches a server log or a Referer header.
      inviteUrl: `${appUrl.replace(/\/$/, '')}/undangan#${invitation.token}`,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  });
}

const notFound = () => new NotFoundError('Undangan tidak ditemukan atau sudah kedaluwarsa.');

async function readInvitation(auth: Auth, token: string) {
  const parsed = parseInvitationToken(token);
  if (!parsed) throw notFound();
  const invitation = await withTenant({ schoolId: parsed.schoolId, userId: null }, (tx) =>
    findOpenInvitation(tx, parsed.schoolId, parsed.hash),
  );
  if (!invitation) throw notFound();
  const user = await findUserById(auth, invitation.userId);
  if (!user) throw notFound();
  const otp = isPhoneOnlyEmail(user.email);
  return {
    parsed,
    invitation,
    user,
    loginMethod: otp ? ('otp' as const) : ('password' as const),
    needsPassword: !otp && !(await hasPassword(auth, user.id)),
  };
}

/** What the accept page shows before the invitee confirms. */
export async function previewInvitation(auth: Auth, token: string): Promise<InvitationPreviewResponse> {
  const { invitation, user, loginMethod, needsPassword } = await readInvitation(auth, token);
  return { schoolName: invitation.schoolName, role: invitation.role, name: user.name, loginMethod, needsPassword };
}

/**
 * Accepts an invitation: an email account without a password must choose one; the membership
 * becomes active. The password is set before the acceptance commits, so a failed acceptance can
 * simply be retried (it then no longer asks for a password).
 */
export async function acceptInvitation(
  auth: Auth,
  input: AcceptInvitationRequest,
  meta: { requestId: string | null; ip: string | null },
): Promise<AcceptInvitationResponse> {
  const { parsed, user, loginMethod, needsPassword } = await readInvitation(auth, input.token);
  if (needsPassword) {
    if (!input.password) throw new ValidationError([{ path: 'password', message: 'Buat kata sandi minimal 10 karakter.' }]);
    await setInitialPassword(auth, user.id, input.password);
  }

  return withTenant({ schoolId: parsed.schoolId, userId: user.id }, async (tx) => {
    const invitation = await findOpenInvitation(tx, parsed.schoolId, parsed.hash);
    if (!invitation) throw notFound();
    await markAccepted(tx, invitation.id, invitation.membershipId);
    const ctx: AuditContext = { schoolId: parsed.schoolId, actorUserId: user.id, ...meta };
    await audit(tx, ctx, 'membership.invitation_accepted', { type: 'membership', id: invitation.membershipId }, {
      before: { status: invitation.status },
      after: { status: 'active' },
    });
    return { schoolId: parsed.schoolId, schoolName: invitation.schoolName, loginMethod };
  });
}
