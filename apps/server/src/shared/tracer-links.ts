import { randomBytes } from 'node:crypto';
import { TRACER_LINK_DAYS, TRACER_LINK_PATH } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { hashValue } from './crypto';

/**
 * Tracer study links (PKL-05). Like action links the token is "<schoolId>.<secret>" (parseActionLinkToken reads both), so the
 * lookup runs in withTenant(school); only the HMAC of the secret is stored. Minted here because notify (which sends them)
 * depends on no module; the pkl module resolves and uses them.
 */
export const tracerLinkHash = (secret: string) => hashValue(`tracer-link:${secret}`);

/** Creates a link for one alumnus and returns the URL to send (token in the fragment: never in a server log or Referer). */
export async function mintTracerLink(tx: Tx, input: { schoolId: string; alumnusId: string; appUrl: string; now?: Date }): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  const now = input.now ?? new Date();
  await tx.insert(schema.tracerLinks).values({
    schoolId: input.schoolId,
    alumnusId: input.alumnusId,
    tokenHash: tracerLinkHash(secret),
    expiresAt: new Date(now.getTime() + TRACER_LINK_DAYS * 86_400_000),
  });
  return `${input.appUrl}${TRACER_LINK_PATH}#${input.schoolId}.${secret}`;
}
