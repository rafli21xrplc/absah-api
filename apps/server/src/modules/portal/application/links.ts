import type { ActionLinkCardRequest, ActionLinkContext, ActionLinkLeave, ActionLinkLeaveRequest, CardDeviceKeys, LinkHeldPickup, LinkPickupDecisionRequest, PickupPhotoLink } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { actionLinkHash, parseActionLinkToken } from '../../../shared/action-links';
import type { AuditContext } from '../../../shared/audit';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withTenant } from '../../../shared/db';
import { CapabilityDisabledError, ConflictError, LinkExpiredError, UnauthenticatedError } from '../../../shared/errors';
import { firstName } from '../../../shared/names';
import { schoolDate } from '../../../shared/school-date';
import { decideHeldPickup, linkCardKeys, linkPickupPhoto, linkPickups } from '../../gate';
import type { ObjectStorage } from '../../../shared/storage';
import { requestLeaveAsGuardian } from '../../leave';
import { dayOf, findLink, leavesOf, markOpened, schoolOf, setCardDevice, spendWrite, studentOf } from '../infrastructure/link-repo';

/** Request metadata for the audit log; a link caller has no user. */
export interface LinkRequestMeta {
  requestId: string | null;
  ip: string | null;
}

type Link = NonNullable<Awaited<ReturnType<typeof findLink>>>;
type School = NonNullable<Awaited<ReturnType<typeof schoolOf>>>;

const DAY_MS = 86_400_000;
const daysBefore = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * Runs `fn` in the link's school with the link resolved: 401 for an unknown token, 410 once it is
 * past its 7 days. `lock` takes the row lock a write needs, so one write wins.
 */
async function withLink<T>(token: string, lock: boolean, fn: (tx: Tx, link: Link, school: School) => Promise<T>, now = new Date()): Promise<T> {
  const parsed = parseActionLinkToken(token);
  if (!parsed) throw new UnauthenticatedError('Tautan tidak dikenal.');
  return withTenant({ schoolId: parsed.schoolId, userId: null }, async (tx) => {
    const link = await findLink(tx, actionLinkHash(parsed.secret), lock);
    const school = link ? await schoolOf(tx, link.schoolId) : undefined;
    if (!link || !school) throw new UnauthenticatedError('Tautan tidak dikenal.');
    if (link.expiresAt <= now) throw new LinkExpiredError();
    return fn(tx, link, school);
  });
}

const auditCtx = (link: Link, meta: LinkRequestMeta): AuditContext => ({ schoolId: link.schoolId, actorUserId: null, requestId: meta.requestId, ip: meta.ip });

/** ORT-01: the student's day, their izin, and what the link can still do. First name only. */
export function linkContext(token: string, now = new Date()): Promise<ActionLinkContext> {
  return withLink(
    token,
    false,
    async (tx, link, school) => {
      const student = await studentOf(tx, link.studentId);
      if (!student) throw new UnauthenticatedError('Tautan tidak dikenal.');
      const today = schoolDate(school.timezone, now);
      const [day, leaves, caps, pickups] = await Promise.all([dayOf(tx, student.enrollmentId, today), leavesOf(tx, student.enrollmentId, daysBefore(today, 7)), readCapabilityRows(tx), linkPickups(tx, link.studentId, today)]);
      await markOpened(tx, link.id, now);
      return {
        school: { name: school.name, timezone: school.timezone },
        student: { firstName: firstName(student.name), className: student.className },
        expiresAt: link.expiresAt.toISOString(),
        today: { date: today, status: day.status, sessions: day.sessions, arrivedAt: day.arrivedAt?.toISOString() ?? null },
        leaves,
        canRequestLeave: link.writeUsedAt === null && student.status === 'active',
        cardAvailable: resolveFromRows(school, caps, today)['gate.enabled'] === true && student.status === 'active',
        pickups,
      };
    },
    now,
  );
}

/** The link's one write: an izin request that waits for the wali kelas. */
export function linkLeave(token: string, meta: LinkRequestMeta, input: ActionLinkLeaveRequest, now = new Date()): Promise<ActionLinkLeave> {
  return withLink(
    token,
    true,
    async (tx, link, school) => {
      if (link.writeUsedAt) throw new ConflictError('Tautan ini sudah dipakai untuk mengajukan izin.', { reason: 'link_used' });
      const student = await studentOf(tx, link.studentId);
      if (!student || student.status !== 'active') throw new ConflictError('Siswa tidak lagi aktif di sekolah ini.', { reason: 'not_active' });
      const leave = await requestLeaveAsGuardian(tx, auditCtx(link, meta), schoolDate(school.timezone, now), { enrollmentId: student.enrollmentId, guardianId: link.guardianId, ...input });
      await spendWrite(tx, link.id, leave.id, now);
      return { id: leave.id, kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn, status: leave.status };
    },
    now,
  );
}

/** The student's card on the phone that opened the link (GRB-01 through ORT-01). */
export function linkCard(token: string, meta: LinkRequestMeta, input: ActionLinkCardRequest, now = new Date()): Promise<CardDeviceKeys> {
  return withLink(
    token,
    true,
    async (tx, link, school) => {
      const today = schoolDate(school.timezone, now);
      if (!resolveFromRows(school, await readCapabilityRows(tx), today)['gate.enabled']) throw new CapabilityDisabledError('gate.enabled');
      const student = await studentOf(tx, link.studentId);
      if (!student || student.status !== 'active') throw new ConflictError('Siswa tidak lagi aktif di sekolah ini.', { reason: 'not_active' });
      const keys = await linkCardKeys(tx, auditCtx(link, meta), { schoolId: link.schoolId, studentId: link.studentId, linkDeviceId: link.cardDeviceId, replace: input.replace, timezone: school.timezone, today });
      if (keys.deviceId !== link.cardDeviceId) await setCardDevice(tx, link.id, keys.deviceId);
      return keys;
    },
    now,
  );
}

/**
 * GRB-10: the parent allows or denies an unlisted penjemput the kiosk holds for their child. Not the
 * link's one write: a held child must always be decidable from the latest message.
 */
export function linkPickupDecision(token: string, meta: LinkRequestMeta, pickupEventId: string, input: LinkPickupDecisionRequest, now = new Date()): Promise<LinkHeldPickup[]> {
  return withLink(
    token,
    false,
    async (tx, link, school) => {
      const today = schoolDate(school.timezone, now);
      await decideHeldPickup(tx, auditCtx(link, meta), { id: pickupEventId, studentId: link.studentId, decision: input.decision, via: 'guardian', userId: null, guardianId: link.guardianId, today, now });
      return linkPickups(tx, link.studentId, today);
    },
    now,
  );
}

/** The unlisted penjemput's photo, so the parent sees who is at the gate (audited). */
export function linkPickupPhotoLink(token: string, meta: LinkRequestMeta, storage: ObjectStorage, pickupEventId: string, now = new Date()): Promise<PickupPhotoLink> {
  return withLink(token, false, (tx, link) => linkPickupPhoto(tx, storage, auditCtx(link, meta), link.studentId, pickupEventId), now);
}
