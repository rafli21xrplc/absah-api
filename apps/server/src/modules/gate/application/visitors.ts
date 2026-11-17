import { VISITOR_PHOTO_RETENTION_DAYS, VISITOR_PHOTO_TYPE, type CreateVisitorPhotoRequest, type CreateVisitorPhotoResponse, type CreateVisitorRequest, type Visitor, type VisitorHostList, type VisitorList, type VisitorPhotoLink, type VisitorsQuery } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withPlatform, withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
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
  markPhotoRemoved,
  photoKeyOf,
  photosDueForRemoval,
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
    hasPhoto: r.hasPhoto,
  };
}

export function visitorHosts(kiosk: KioskCaller): Promise<VisitorHostList> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => ({ items: await hostCandidates(tx) }));
}

/** A presigned PUT for the guest's photo; the key is built from the kiosk's own school. */
export async function createVisitorPhoto(kiosk: KioskCaller, storage: ObjectStorage, input: CreateVisitorPhotoRequest): Promise<CreateVisitorPhotoResponse> {
  const photoId = uuidv7();
  const upload = await storage.presignUpload({ key: storageKey(kiosk.schoolId, 'visitors', photoId), contentType: input.contentType, contentLength: input.fileSize });
  return { photoId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

/**
 * A guest signs in at the kiosk. One visit per clientEventId (a resend returns the stored visit and
 * tells nobody twice); naming a host emits gate.visitor_arrived.
 */
export async function registerVisitor(kiosk: KioskCaller, storage: ObjectStorage, input: CreateVisitorRequest): Promise<Visitor> {
  const photoKey = input.photoId ? storageKey(kiosk.schoolId, 'visitors', input.photoId) : null;
  if (photoKey && !(await storage.read(photoKey))) throw new ValidationError([{ path: 'photoId', message: 'Foto belum terunggah. Ambil ulang.' }]);
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
      photoKey,
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

/** Looking at a photo is itself access to personal data: audited like other sensitive reads. */
export function visitorPhotoLink(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, visitorId: string): Promise<VisitorPhotoLink> {
  if (!canSeeVisitors.allows(actor)) throw new ForbiddenError('Foto tamu untuk guru piket dan pimpinan sekolah.');
  return withTenant(scope(actor), async (tx) => {
    const key = await photoKeyOf(tx, visitorId);
    if (!key) throw new NotFoundError('Tamu ini tanpa foto.');
    await audit(tx, auditCtx, 'gate.visitor_photo_viewed', { type: 'visitor', id: visitorId });
    const link = await storage.presignDownload({ key, contentType: VISITOR_PHOTO_TYPE });
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  });
}

/**
 * Removes photos VISITOR_PHOTO_RETENTION_DAYS after the guest left (or arrived, when nobody signed
 * them out). Runs across schools: withPlatform reads and marks, the file goes first so a failure
 * retries on the next run.
 */
export async function purgeVisitorPhotos(storage: ObjectStorage, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - VISITOR_PHOTO_RETENTION_DAYS * 86_400_000);
  const due = await withPlatform((tx) => photosDueForRemoval(tx, cutoff));
  for (const row of due) {
    if (!row.photoKey) continue;
    await storage.remove(row.photoKey);
    await withPlatform((tx) => markPhotoRemoved(tx, row.id, now));
  }
  return due.length;
}
