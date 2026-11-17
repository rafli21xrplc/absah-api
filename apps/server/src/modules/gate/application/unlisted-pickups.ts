import {
  PICKUP_PHOTO_RETENTION_DAYS,
  PICKUP_PHOTO_TYPE,
  type CreateKioskPickupPhotoRequest,
  type CreatePickupPhotoResponse,
  type KioskUnlistedPickup,
  type KioskUnlistedPickupRequest,
  type LinkHeldPickup,
  type PickupDecision,
  type PickupEvent,
  type PickupEventList,
  type PickupEventsQuery,
  type PickupPhotoLink,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { firstName } from '../../../shared/names';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canDecidePickupGuardians, canSeeGateToday, canSeePickupPhotos } from '../domain/policies';
import { decideEvent, eventsByClientId, eventsOfDay, expirePastHeld, findEvent, insertEvent, lockEvent, markUnlistedPhotoRemoved, releasedOn, unlistedOfStudent, unlistedPhotosDue, type PickupEventView } from '../infrastructure/checkout-repo';
import { relationTo } from '../infrastructure/pickup-repo';
import { dayKeysOf, verifyCardAt } from './checkouts';
import type { KioskCaller } from './kiosks';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NOT_FOUND = 'Penjemputan tidak ditemukan.';
const via = (v: string | null) => (v === 'guardian' || v === 'staff' ? v : null);

function eventView(r: PickupEventView): PickupEvent {
  return {
    id: r.id,
    schoolDate: r.schoolDate,
    studentId: r.studentId,
    studentName: r.studentName,
    className: r.className,
    pickupName: r.pickupName,
    listed: r.unlistedPhotoKey === null,
    status: r.status,
    requestedAt: r.createdAt.toISOString(),
    checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
    decidedVia: via(r.decidedVia),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    hasPhoto: r.unlistedPhotoKey !== null && r.photoRemovedAt === null,
  };
}

const kioskView = (r: PickupEventView): KioskUnlistedPickup => ({ id: r.id, status: r.status, firstName: firstName(r.studentName), pickupName: r.pickupName, decidedVia: via(r.decidedVia) });

export async function createKioskPickupPhoto(kiosk: KioskCaller, storage: ObjectStorage, input: CreateKioskPickupPhotoRequest): Promise<CreatePickupPhotoResponse> {
  const photoId = uuidv7();
  const upload = await storage.presignUpload({ key: storageKey(kiosk.schoolId, 'pickup', photoId), contentType: input.contentType, contentLength: input.fileSize });
  return { photoId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

/**
 * The kiosk holds a student for an unlisted penjemput: name and photo are required. Exactly once per
 * clientEventId; emits gate.unlisted_pickup (parents asked through the action link). A student
 * already released today is a conflict.
 */
export async function requestUnlistedPickup(kiosk: KioskCaller, storage: ObjectStorage, input: KioskUnlistedPickupRequest): Promise<KioskUnlistedPickup> {
  const photoKey = storageKey(kiosk.schoolId, 'pickup', input.photoId);
  if (!(await storage.read(photoKey))) throw new ValidationError([{ path: 'photoId', message: 'Foto belum terunggah. Ambil ulang.' }]);
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => {
    const stored = async () => {
      const [known] = await eventsByClientId(tx, [input.clientEventId]);
      return known ? await findEvent(tx, known.id) : undefined;
    };
    const earlier = await stored();
    if (earlier) return kioskView(earlier);
    const at = new Date(input.requestedAt);
    const card = await verifyCardAt(tx, kiosk, input.token, at, await dayKeysOf(tx, kiosk.schoolId));
    if (!card.ok) throw new ValidationError([{ path: 'token', message: `Kartu tidak dapat dibaca (${card.reason}). Pindai ulang.` }]);
    const date = schoolDate(kiosk.timezone, at);
    if (await releasedOn(tx, card.enrollmentId, date)) throw new ConflictError(`${firstName(card.name)} sudah dijemput hari ini.`, { reason: 'already_released' });
    const id = uuidv7();
    const row = { id, schoolId: kiosk.schoolId, schoolDate: date, clientEventId: input.clientEventId, kioskId: kiosk.kioskId, studentId: card.studentId, enrollmentId: card.enrollmentId, pickupGuardianId: null, pickupName: input.name, unlistedPhotoKey: photoKey, status: 'held' as const, checkedOutAt: null };
    if (await insertEvent(tx, row)) await emit(tx, 'gate.unlisted_pickup', { pickupEventId: id });
    const made = await stored();
    if (!made) throw new Error('pickup event vanished');
    return kioskView(made);
  });
}

/** What the kiosk polls while holding the student. */
export function kioskUnlistedPickup(kiosk: KioskCaller, id: string): Promise<KioskUnlistedPickup> {
  return withTenant({ schoolId: kiosk.schoolId, userId: null }, async (tx) => {
    const row = await findEvent(tx, id);
    if (!row || row.unlistedPhotoKey === null) throw new NotFoundError(NOT_FOUND);
    return kioskView(row);
  });
}

/**
 * Decides a held request: allow releases the student (emits gate.checked_out, parents told who and
 * when), deny keeps them. The same decision again changes nothing; any other is 409 (already
 * decided, past its day, or the student left with someone else).
 */
export async function decideHeldPickup(
  tx: Tx,
  auditCtx: AuditContext,
  input: { id: string; studentId?: string; decision: PickupDecision; via: 'guardian' | 'staff'; userId: string | null; guardianId?: string; today: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const event = await lockEvent(tx, input.id);
  if (!event || !event.unlisted || (input.studentId && event.studentId !== input.studentId)) throw new NotFoundError(NOT_FOUND);
  const target = input.decision === 'allow' ? 'released' : 'denied';
  if (event.status === target) return;
  if (event.status !== 'held') throw new ConflictError('Penjemputan ini sudah diputuskan.', { reason: 'decided', status: event.status });
  if (event.schoolDate < input.today) {
    await decideEvent(tx, input.id, { status: 'expired', decidedBy: null, decidedVia: null, at: now });
    throw new ConflictError('Permintaan ini sudah kedaluwarsa.', { reason: 'expired' });
  }
  if (target === 'released' && (await releasedOn(tx, event.enrollmentId, event.schoolDate, input.id))) {
    throw new ConflictError('Siswa sudah dijemput orang lain hari ini.', { reason: 'already_released' });
  }
  await decideEvent(tx, input.id, { status: target, decidedBy: input.userId, decidedVia: input.via, at: now });
  await audit(tx, auditCtx, `gate.unlisted_pickup_${target}`, { type: 'pickup_event', id: input.id }, { after: { status: target, via: input.via, ...(input.guardianId ? { guardianId: input.guardianId } : {}) } });
  if (target === 'released') await emit(tx, 'gate.checked_out', { pickupEventId: input.id });
}

/** Today's unlisted requests of the student, for the parent's action link page. */
export async function linkPickups(tx: Tx, studentId: string, today: string): Promise<LinkHeldPickup[]> {
  return (await unlistedOfStudent(tx, studentId, today)).map((r) => ({ id: r.id, pickupName: r.pickupName, requestedAt: r.createdAt.toISOString(), status: r.status }));
}

/** The unlisted penjemput's photo for the parent deciding (the link holder guards the student). */
export async function linkPickupPhoto(tx: Tx, storage: ObjectStorage, auditCtx: AuditContext, studentId: string, id: string): Promise<PickupPhotoLink> {
  const row = await findEvent(tx, id);
  if (!row || row.studentId !== studentId || !row.unlistedPhotoKey || row.photoRemovedAt) throw new NotFoundError(NOT_FOUND);
  await audit(tx, auditCtx, 'gate.unlisted_photo_viewed', { type: 'pickup_event', id }, { after: { via: 'guardian' } });
  const link = await storage.presignDownload({ key: row.unlistedPhotoKey, contentType: PICKUP_PHOTO_TYPE });
  return { url: link.url, expiresAt: link.expiresAt.toISOString() };
}

/** The day's check-outs: the gate's viewers see all, anyone else their own rombel as wali kelas. */
export function listPickups(actor: Actor, timezone: string, query: PickupEventsQuery): Promise<PickupEventList> {
  const date = query.date ?? schoolDate(timezone);
  return withTenant(scope(actor), async (tx) => ({
    schoolDate: date,
    items: (await eventsOfDay(tx, date, canSeeGateToday.allows(actor) ? null : actor.userId)).map(eventView),
  }));
}

/** The wali kelas of the student or the admin allows or denies a held request. */
export function staffDecidePickup(actor: Actor, auditCtx: AuditContext, timezone: string, id: string, decision: PickupDecision): Promise<PickupEvent> {
  return withTenant(scope(actor), async (tx) => {
    const row = await findEvent(tx, id);
    const rel = row ? await relationTo(tx, row.studentId, actor.userId) : undefined;
    if (!row || !rel || !(rel.homeroom || canDecidePickupGuardians.allows(actor))) throw new NotFoundError(NOT_FOUND);
    await decideHeldPickup(tx, auditCtx, { id, decision, via: 'staff', userId: actor.userId, today: schoolDate(timezone) });
    const after = await findEvent(tx, id);
    if (!after) throw new NotFoundError(NOT_FOUND);
    return eventView(after);
  });
}

/** The unlisted penjemput's photo: the student's wali kelas, piket, admin; audited. */
export function unlistedPhotoLink(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, id: string): Promise<PickupPhotoLink> {
  return withTenant(scope(actor), async (tx) => {
    const row = await findEvent(tx, id);
    const rel = row ? await relationTo(tx, row.studentId, actor.userId) : undefined;
    if (!row || !rel || !(rel.homeroom || canSeePickupPhotos.allows(actor))) throw new NotFoundError(NOT_FOUND);
    if (!row.unlistedPhotoKey || row.photoRemovedAt) throw new NotFoundError('Foto penjemput ini tidak ada atau sudah dihapus.');
    await audit(tx, auditCtx, 'gate.unlisted_photo_viewed', { type: 'pickup_event', id });
    const link = await storage.presignDownload({ key: row.unlistedPhotoKey, contentType: PICKUP_PHOTO_TYPE });
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  });
}

/** Nightly: held requests of past days expire; unlisted photos go PICKUP_PHOTO_RETENTION_DAYS after the request. */
export async function expireAndPurgeUnlisted(storage: ObjectStorage, now = new Date()): Promise<{ expired: number; removed: number }> {
  const expired = await withPlatform((tx) => expirePastHeld(tx));
  const cutoff = new Date(now.getTime() - PICKUP_PHOTO_RETENTION_DAYS * 86_400_000);
  const due = await withPlatform((tx) => unlistedPhotosDue(tx, cutoff));
  for (const row of due) {
    if (row.photoKey) await storage.remove(row.photoKey);
    await withPlatform((tx) => markUnlistedPhotoRemoved(tx, row.id, now));
  }
  return { expired, removed: due.length };
}
