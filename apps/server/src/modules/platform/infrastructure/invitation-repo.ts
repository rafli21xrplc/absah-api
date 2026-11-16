import type { Role } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { hashValue } from '../../../shared/crypto';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "<schoolId>.<32 random bytes base64url>" */
export function parseInvitationToken(token: string): { schoolId: string; hash: string } | null {
  const [schoolId, secret, extra] = token.split('.');
  if (extra !== undefined || !schoolId || !UUID_RE.test(schoolId) || !secret || !/^[\w-]{43}$/.test(secret)) return null;
  return { schoolId: schoolId.toLowerCase(), hash: hashValue(token) };
}

export async function findMembership(tx: Tx, schoolId: string, userId: string, role: Role) {
  const m = schema.memberships;
  const [row] = await tx
    .select({ id: m.id, status: m.status })
    .from(m)
    .where(and(eq(m.schoolId, schoolId), eq(m.userId, userId), eq(m.role, role), isNull(m.academicYearId)))
    .for('update');
  return row;
}

export async function insertInvitedMembership(tx: Tx, schoolId: string, userId: string, role: Role): Promise<string> {
  const [row] = await tx
    .insert(schema.memberships)
    .values({ schoolId, userId, role, status: 'invited' })
    .returning({ id: schema.memberships.id });
  if (!row) throw new Error('membership insert returned nothing');
  return row.id;
}

/** Replaces any open invitation of the membership with a fresh token. Returns the plain token once. */
export async function issueInvitation(tx: Tx, input: { schoolId: string; membershipId: string; createdBy: string | null }) {
  const i = schema.invitations;
  await tx.delete(i).where(and(eq(i.membershipId, input.membershipId), isNull(i.acceptedAt)));
  const token = `${input.schoolId}.${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const [row] = await tx
    .insert(i)
    .values({ ...input, tokenHash: hashValue(token), expiresAt })
    .returning({ id: i.id });
  if (!row) throw new Error('invitation insert returned nothing');
  return { id: row.id, token, expiresAt };
}

/** The open, unexpired invitation for a token hash, with its membership and school (locked). */
export async function findOpenInvitation(tx: Tx, schoolId: string, tokenHash: string) {
  const { invitations: i, memberships: m, schools: s } = schema;
  const [row] = await tx
    .select({
      id: i.id,
      membershipId: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      schoolName: s.name,
    })
    .from(i)
    .innerJoin(m, eq(m.id, i.membershipId))
    .innerJoin(s, eq(s.id, i.schoolId))
    .where(and(eq(i.schoolId, schoolId), eq(i.tokenHash, tokenHash), isNull(i.acceptedAt), gt(i.expiresAt, new Date())))
    .for('update', { of: [i, m] });
  return row;
}

export async function markAccepted(tx: Tx, invitationId: string, membershipId: string): Promise<void> {
  await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, invitationId));
  await tx.update(schema.memberships).set({ status: 'active' }).where(eq(schema.memberships.id, membershipId));
}
