import type { SaveTracerResponseRequest, TracerFormContext } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { parseActionLinkToken } from '../../../shared/action-links';
import { audit } from '../../../shared/audit';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withTenant } from '../../../shared/db';
import { CapabilityDisabledError, LinkExpiredError, UnauthenticatedError } from '../../../shared/errors';
import { firstName } from '../../../shared/names';
import { schoolDate } from '../../../shared/school-date';
import { tracerLinkHash } from '../../../shared/tracer-links';
import { alumniRows, findTracerLink, markTracerLinkOpened, schoolProfile, upsertResponse, type AlumniRow } from '../infrastructure/tracer-repo';

/** Request metadata for the audit log; an alumnus has no user. */
export interface TracerLinkMeta {
  requestId: string | null;
  ip: string | null;
}

type Link = NonNullable<Awaited<ReturnType<typeof findTracerLink>>>;

/**
 * Runs `fn` in the link's school with the link resolved: 401 for an unknown token, 410 past its 30 days, 404 when the school
 * switched the tracer study off. `lock` takes the row lock a write needs.
 */
async function withTracerLink<T>(token: string, lock: boolean, fn: (tx: Tx, link: Link, alumnus: AlumniRow, schoolName: string) => Promise<T>, now = new Date()): Promise<T> {
  const parsed = parseActionLinkToken(token);
  if (!parsed) throw new UnauthenticatedError('Tautan tidak dikenal.');
  return withTenant({ schoolId: parsed.schoolId, userId: null }, async (tx) => {
    const link = await findTracerLink(tx, tracerLinkHash(parsed.secret), lock);
    const school = link ? await schoolProfile(tx, link.schoolId) : undefined;
    const [alumnus] = link ? await alumniRows(tx, { id: link.alumnusId }) : [];
    if (!link || !school || !alumnus) throw new UnauthenticatedError('Tautan tidak dikenal.');
    if (link.expiresAt <= now) throw new LinkExpiredError();
    if (!resolveFromRows(school, await readCapabilityRows(tx), schoolDate(school.timezone, now))['pkl.tracer']) throw new CapabilityDisabledError('pkl.tracer');
    return fn(tx, link, alumnus, school.name);
  });
}

const contextOf = (link: Link, alumnus: AlumniRow, schoolName: string): TracerFormContext => ({
  schoolName,
  firstName: firstName(alumnus.name),
  graduationYear: alumnus.graduationYear,
  response:
    alumnus.status && alumnus.answeredAt
      ? { status: alumnus.status, organization: alumnus.organization?.reveal() ?? null, position: alumnus.position?.reveal() ?? null, answeredAt: alumnus.answeredAt.toISOString() }
      : null,
  expiresAt: link.expiresAt.toISOString(),
});

/** What the alumni page shows: first name, school, the current answer. */
export function tracerFormContext(token: string, now = new Date()): Promise<TracerFormContext> {
  return withTracerLink(
    token,
    false,
    async (tx, link, alumnus, schoolName) => {
      await markTracerLinkOpened(tx, link.id, now);
      return contextOf(link, alumnus, schoolName);
    },
    now,
  );
}

/** The alumnus answers (source alumni); answering again, until the link expires, replaces it. */
export function saveTracerForm(token: string, meta: TracerLinkMeta, input: SaveTracerResponseRequest, now = new Date()): Promise<TracerFormContext> {
  return withTracerLink(
    token,
    true,
    async (tx, link, alumnus, schoolName) => {
      const bmw = input.status !== 'belum';
      await upsertResponse(tx, { id: uuidv7(), schoolId: link.schoolId, alumnusId: alumnus.id, status: input.status, organization: bmw ? (input.organization ?? null) : null, position: bmw ? (input.position || null) : null, source: 'alumni', enteredBy: null });
      await audit(tx, { schoolId: link.schoolId, actorUserId: null, requestId: meta.requestId, ip: meta.ip }, 'tracer.response_given', { type: 'tracer_alumnus', id: alumnus.id }, { before: { status: alumnus.status }, after: { status: input.status } });
      const [row] = await alumniRows(tx, { id: alumnus.id });
      if (!row) throw new Error('alumnus vanished');
      return contextOf(link, row, schoolName);
    },
    now,
  );
}
