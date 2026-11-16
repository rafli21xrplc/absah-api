import type { Auth } from './auth';

/**
 * Creates a staff account. Public sign-up is disabled, so this is the only path (invitations,
 * seeds, tests). Without a password the account cannot log in until its invitation is accepted.
 */
export async function createStaffUser(
  auth: Auth,
  input: { name: string; email: string; password?: string; phoneNumber?: string },
): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({
    name: input.name,
    email: input.email.toLowerCase(),
    emailVerified: true,
  }, { method: 'admin' });
  if (input.phoneNumber) await setPhoneNumber(auth, user.id, input.phoneNumber);
  if (input.password) await setInitialPassword(auth, user.id, input.password);
  return { id: user.id };
}

/** Adds the email + password login to an account that has none yet. */
export async function setInitialPassword(auth: Auth, userId: string, password: string): Promise<void> {
  const ctx = await auth.$context;
  await ctx.internalAdapter.linkAccount({
    userId,
    providerId: 'credential',
    accountId: userId,
    password: await ctx.password.hash(password),
  });
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

/** Looks up accounts across schools (auth tables, login role; never exposed beyond the caller). */
export async function findUserByEmail(auth: Auth, email: string): Promise<UserSummary | null> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
  return found ? { id: found.user.id, name: found.user.name, email: found.user.email } : null;
}

export async function findUserByPhone(auth: Auth, phoneNumber: string): Promise<UserSummary | null> {
  const ctx = await auth.$context;
  const user = await ctx.adapter.findOne<UserSummary>({ model: 'user', where: [{ field: 'phoneNumber', value: phoneNumber }] });
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

export async function findUserById(auth: Auth, userId: string): Promise<UserSummary | null> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.findUserById(userId);
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

export async function hasPassword(auth: Auth, userId: string): Promise<boolean> {
  const ctx = await auth.$context;
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  return accounts.some((a) => a.providerId === 'credential' && Boolean(a.password));
}

export const isPhoneOnlyEmail = (email: string) => email.endsWith('@phone.absah.invalid');

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
export async function setPhoneNumber(auth: Auth, userId: string, phoneNumber: string): Promise<void> {
  const ctx = await auth.$context;
  const updated = await ctx.internalAdapter.updateUser(userId, { phoneNumber, phoneNumberVerified: false });
  if (!updated) throw new Error('setPhoneNumber: user not found');
}
