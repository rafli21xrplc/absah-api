import type { Auth } from './auth';

/**
 * Creates a staff account with a password. Public sign-up is disabled, so this is the only path
 * (used by invitations in prompt 1.5, seeds and tests).
 */
export async function createStaffUser(
  auth: Auth,
  input: { name: string; email: string; password: string; phoneNumber?: string },
): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({
    name: input.name,
    email: input.email.toLowerCase(),
    emailVerified: true,
  }, { method: 'admin' });
  if (input.phoneNumber) await setPhoneNumber(auth, user.id, input.phoneNumber);
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });
  return { id: user.id };
}

/** Phone-only account (parent, industry supervisor). Logs in with WhatsApp OTP. */
export async function createPhoneUser(
  auth: Auth,
  input: { name: string; phoneNumber: string },
): Promise<{ id: string }> {
  const ctx = await auth.$context;
  // Better Auth requires an email; phone-only users get a non-routable placeholder.
  const placeholder = `${input.phoneNumber.replace(/\D/g, '')}@phone.absah.invalid`;
  const user = await ctx.internalAdapter.createUser({
    name: input.name,
    email: placeholder,
    emailVerified: false,
  }, { method: 'admin' });
  await setPhoneNumber(auth, user.id, input.phoneNumber);
  return { id: user.id };
}

/** createUser drops plugin fields such as phoneNumber, so set it the way Better Auth itself does. */
async function setPhoneNumber(auth: Auth, userId: string, phoneNumber: string): Promise<void> {
  const ctx = await auth.$context;
  const updated = await ctx.internalAdapter.updateUser(userId, { phoneNumber, phoneNumberVerified: false });
  if (!updated) throw new Error('setPhoneNumber: user not found');
}
