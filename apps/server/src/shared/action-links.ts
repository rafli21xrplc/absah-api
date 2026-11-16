import { randomBytes } from 'node:crypto';
import { ACTION_LINK_DAYS, ACTION_LINK_PATH } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { hashValue } from './crypto';

/**
 * Tautan aksi tokens (ORT-01). Minted here because notify (which sends them) depends on no module;
 * the portal module resolves and uses them. Token "<schoolId>.<secret>", like kiosk pairing codes,
 * so the lookup runs in withTenant(school); only the HMAC of the secret is stored.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function parseActionLinkToken(token: string): { schoolId: string; secret: string } | null {
  const [schoolId = '', secret = '', ...rest] = token.trim().split('.');
  return rest.length === 0 && UUID.test(schoolId) && SECRET.test(secret) ? { schoolId, secret } : null;
}

export const actionLinkHash = (secret: string) => hashValue(`action-link:${secret}`);

/** Creates a link for one guardian about one student and returns the URL to send. */
export async function mintActionLink(tx: Tx, input: { schoolId: string; guardianId: string; studentId: string; appUrl: string; now?: Date }): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  const now = input.now ?? new Date();
  await tx.insert(schema.actionLinks).values({
    schoolId: input.schoolId,
    guardianId: input.guardianId,
    studentId: input.studentId,
    tokenHash: actionLinkHash(secret),
    expiresAt: new Date(now.getTime() + ACTION_LINK_DAYS * 86_400_000),
  });
  // Fragment, not path: the token never reaches a web server log or a Referer header (like invitations).
  return `${input.appUrl}${ACTION_LINK_PATH}#${input.schoolId}.${secret}`;
}
