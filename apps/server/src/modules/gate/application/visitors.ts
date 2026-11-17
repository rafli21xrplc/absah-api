import type { CreateVisitorRequest, Visitor, VisitorHostList, VisitorList, VisitorsQuery } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { canManageVisitors, canSeeVisitors } from '../domain/policies';
import {
  countInside,
  findByClientEvent,
  findVisitor,
  hostCandidates,
  insertVisitor,
  isHostCandidate,
  lockVisitor,
  markLeft,
  visitorsOfDay,
  type VisitorRow,
} from '../infrastructure/visitor-repo';
import type { KioskCaller } from './kiosks';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

function view(r: VisitorRow): Visitor {
  return {
    id: r.id,
    schoolDate: r.schoolDate,
    name: r.name,
    organization: r.organization,
    purpose: r.purpose,
    host: r.hostUserId ? { id: r.hostUserId, name: r.hostName ?? '' } : null,
    arrivedAt: r.arrivedAt.toISOString(),
    leftAt: r.leftAt?.toISOString() ?? null,
  };
}

export function visitorHosts(kiosk: KioskCaller): Promise<VisitorHostList> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => ({ items: await hostCandidates(tx) }));
}

/**
 * A guest signs in at the kiosk. One visit per clientEventId (a resend returns the stored visit and
 * tells nobody twice); naming a host emits gate.visitor_arrived.
 */
export function registerVisitor(kiosk: KioskCaller, input: CreateVisitorRequest): Promise<Visitor> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => {
    const known = await findByClientEvent(tx, input.clientEventId);
    if (known) return view(known);
    if (input.hostUserId && !(await isHostCandidate(tx, input.hostUserId))) {
      throw new ValidationError([{ path: 'hostUserId', message: 'Guru atau staf yang dituju tidak ditemukan.' }]);
    }
    const id = uuidv7();
    const inserted = await insertVisitor(tx, {
      id,
      schoolId: kiosk.schoolId,
      schoolDate: schoolDate(kiosk.timezone),
      clientEventId: input.clientEventId,
      kioskId: kiosk.kioskId,
      name: input.name,
      organization: input.organization || null,
      purpose: input.purpose,
      hostUserId: input.hostUserId ?? null,
    });
    const row = await findByClientEvent(tx, input.clientEventId);
    if (!row) throw new Error('visitor vanished');
    if (inserted && input.hostUserId) await emit(tx, 'gate.visitor_arrived', { visitorId: id, hostUserId: input.hostUserId });
    return view(row);
  });
}

/** The day's guests (default today), who is still inside first counted. */
export function listVisitors(actor: Actor, timezone: string, query: VisitorsQuery): Promise<VisitorList> {
  if (!canSeeVisitors.allows(actor)) throw new ForbiddenError('Buku tamu untuk guru piket dan pimpinan sekolah.');
  const date = query.date ?? schoolDate(timezone);
  return withTenant(scope(actor), async (tx) => ({
    schoolDate: date,
    inside: await countInside(tx, date),
    items: (await visitorsOfDay(tx, date, query.status === 'inside')).map(view),
  }));
}

/** Piket signs a guest out. Signing out again changes nothing (a retry after a lost response). */
export function leaveVisitor(actor: Actor, auditCtx: AuditContext, visitorId: string): Promise<Visitor> {
  if (!canManageVisitors.allows(actor)) throw new ForbiddenError('Tamu dikeluarkan oleh guru piket.');
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockVisitor(tx, visitorId);
    if (!locked) throw new NotFoundError('Tamu tidak ditemukan.');
    if (!locked.leftAt) {
      await markLeft(tx, visitorId, actor.userId, new Date());
      await audit(tx, auditCtx, 'gate.visitor_left', { type: 'visitor', id: visitorId }, { after: { leftBy: actor.userId } });
    }
    const row = await findVisitor(tx, visitorId);
    if (!row) throw new NotFoundError('Tamu tidak ditemukan.');
    return view(row);
  });
}
