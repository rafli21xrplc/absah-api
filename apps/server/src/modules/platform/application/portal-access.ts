import { schema, type Tx } from '@absah/db';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError } from '../../../shared/errors';
import type { Auth } from '../infrastructure/auth';
import { findMembership } from '../infrastructure/invitation-repo';
import { createPhoneUser, findUserByPhone, setPhoneNumber } from '../infrastructure/users';

const TAKEN = 'Nomor ini sudah dipakai akun lain. Pakai nomor lain.';

/**
 * The phone login of a portal user (ORT-02): creates it, or moves `currentUserId` to the new number.
 * A number that already belongs to another account is refused, so no one gains access to a
 * student through a number they did not register. Owning the number is proven at each OTP login.
 */
export async function ensurePhoneLogin(auth: Auth, input: { name: string; phoneNumber: string; currentUserId: string | null }): Promise<string> {
  const owner = await findUserByPhone(auth, input.phoneNumber);
  if (owner && owner.id !== input.currentUserId) throw new ConflictError(TAKEN, { reason: 'phone_taken' });
  if (input.currentUserId) {
    if (!owner) await setPhoneNumber(auth, input.currentUserId, input.phoneNumber);
    return input.currentUserId;
  }
  return (await createPhoneUser(auth, { name: input.name, phoneNumber: input.phoneNumber })).id;
}

/**
 * The login of a guardian (ORT-02) or an industry supervisor (PKL-01): the account that owns the
 * number, or a new one. Unlike a student's login it is shared: one parent with children in several
 * rombel or schools, or one supervisor for several schools, logs in once. Owning the number is
 * proven at each OTP login.
 */
export async function sharedPhoneLogin(auth: Auth, input: { name: string; phoneNumber: string }): Promise<string> {
  const owner = await findUserByPhone(auth, input.phoneNumber);
  return owner?.id ?? (await createPhoneUser(auth, input)).id;
}

/** Roles that need no invitation: the OTP login is the proof (portal, industry supervisors). */
export type PhoneRole = 'siswa' | 'orang_tua' | 'pembimbing_industri';

/** Activates (or suspends) a phone-role membership without an invitation. */
export async function setPortalMembership(tx: Tx, input: { schoolId: string; userId: string; role: PhoneRole; active: boolean }): Promise<void> {
  const m = schema.memberships;
  const current = await findMembership(tx, input.schoolId, input.userId, input.role);
  const status = input.active ? 'active' : 'suspended';
  if (current) {
    if (current.status !== status) await tx.update(m).set({ status }).where(eq(m.id, current.id));
  } else if (input.active) {
    await tx.insert(m).values({ schoolId: input.schoolId, userId: input.userId, role: input.role, status });
  }
}

/** Whether the user has an active membership with the role in the current school. */
export async function hasActiveMembership(tx: Tx, userId: string, role: PhoneRole): Promise<boolean> {
  const m = schema.memberships;
  const [row] = await tx
    .select({ id: m.id })
    .from(m)
    .where(and(eq(m.userId, userId), eq(m.role, role), eq(m.status, 'active'), isNull(m.academicYearId)));
  return row !== undefined;
}

/** The login number of a user, read through Better Auth (its tables are not tenant data). */
export async function loginPhoneOf(auth: Auth, userId: string): Promise<string | null> {
  const ctx = await auth.$context;
  const user = await ctx.adapter.findOne<{ phoneNumber?: string | null }>({ model: 'user', where: [{ field: 'id', value: userId }] });
  return user?.phoneNumber ?? null;
}
