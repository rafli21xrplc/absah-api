import {
  maskPhone,
  PICKUP_GUARDIANS_MAX,
  PICKUP_PHOTO_RETENTION_DAYS,
  PICKUP_PHOTO_TYPE,
  type CreatePickupGuardianRequest,
  type CreatePickupPhotoRequest,
  type CreatePickupPhotoResponse,
  type PickupGuardian,
  type PickupGuardianList,
  type PickupGuardiansQuery,
  type PickupPhotoLink,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canDecidePickupGuardians, canSeePickupPhotos } from '../domain/policies';
import {
  findGuardian,
  guardiansByStatus,
  guardiansOfStudent,
  insertGuardian,
  lockGuardian,
  markPhotoRemoved,
  openCount,
  photosDueForRemoval,
  relationTo,
  setStatus,
  type PickupGuardianRow,
  type StudentRelation,
} from '../infrastructure/pickup-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NO_STUDENT = 'Siswa tidak ditemukan.';
const NO_ENTRY = 'Penjemput tidak ditemukan.';

export function pickupView(r: PickupGuardianRow): PickupGuardian {
  return {
    id: r.id,
    studentId: r.studentId,
    studentName: r.studentName,
    className: r.className,
    name: r.name,
    relation: r.relation,
    phone: maskPhone(r.phone.reveal()),
    status: r.status,
    validUntil: r.validUntil,
    hasPhoto: r.photoRemovedAt === null,
    registeredAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

/** Staff who decide for this student: the admin, or the wali kelas of their rombel. */
const decides = (actor: Actor, rel: StudentRelation) => rel.homeroom || canDecidePickupGuardians.allows(actor);

/** Parent, wali kelas or admin; anyone else gets 404 (the student's existence is not revealed). */
async function relationOrNotFound(tx: Tx, actor: Actor, studentId: string, alsoPhotoViewers = false): Promise<StudentRelation> {
  const rel = await relationTo(tx, studentId, actor.userId);
  if (!rel || !(rel.guardian || decides(actor, rel) || (alsoPhotoViewers && canSeePickupPhotos.allows(actor)))) throw new NotFoundError(NO_STUDENT);
  return rel;
}

/** A presigned PUT for the photo; the key is built from the caller's school. */
export function createPickupPhoto(actor: Actor, storage: ObjectStorage, input: CreatePickupPhotoRequest): Promise<CreatePickupPhotoResponse> {
  return withTenant(scope(actor), async (tx) => {
    await relationOrNotFound(tx, actor, input.studentId);
    const photoId = uuidv7();
    const upload = await storage.presignUpload({ key: storageKey(actor.schoolId, 'pickup', photoId), contentType: input.contentType, contentLength: input.fileSize });
    return { photoId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
  });
}

/**
 * GRB-09: a parent registers a penjemput (pending until the wali kelas or admin approves); an entry
 * by the wali kelas or admin is approved at once. The audit log never holds the number.
 */
export async function registerPickupGuardian(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, studentId: string, input: CreatePickupGuardianRequest, now = new Date()): Promise<PickupGuardian> {
  const photoKey = storageKey(actor.schoolId, 'pickup', input.photoId);
  return withTenant(scope(actor), async (tx) => {
    const rel = await relationOrNotFound(tx, actor, studentId);
    if (!(await storage.read(photoKey))) throw new ValidationError([{ path: 'photoId', message: 'Foto belum terunggah. Ambil ulang.' }]);
    if ((await openCount(tx, studentId)) >= PICKUP_GUARDIANS_MAX) {
      throw new ConflictError(`Paling banyak ${PICKUP_GUARDIANS_MAX} penjemput per siswa. Nonaktifkan yang tidak dipakai.`, { reason: 'too_many' });
    }
    const id = uuidv7();
    const status = decides(actor, rel) ? 'approved' : 'pending';
    await insertGuardian(tx, { id, schoolId: actor.schoolId, studentId, name: input.name, relation: input.relation, phone: input.phone, photoKey, validUntil: input.validUntil ?? null, status, registeredBy: actor.userId, now });
    await audit(tx, auditCtx, 'gate.pickup_guardian_registered', { type: 'pickup_guardian', id }, { after: { studentId, relation: input.relation, status } });
    const row = await findGuardian(tx, id);
    if (!row) throw new Error('pickup guardian vanished');
    return pickupView(row);
  });
}

/** The student's penjemput, every status (parent, wali kelas, admin, piket). */
export function studentPickupGuardians(actor: Actor, studentId: string): Promise<PickupGuardianList> {
  return withTenant(scope(actor), async (tx) => {
    await relationOrNotFound(tx, actor, studentId, true);
    return { items: (await guardiansOfStudent(tx, studentId)).map(pickupView) };
  });
}

/** The approval queue: everything for the admin, the own rombel for anyone else (empty if none). */
export function pickupGuardianQueue(actor: Actor, query: PickupGuardiansQuery): Promise<PickupGuardianList> {
  return withTenant(scope(actor), async (tx) => ({
    items: (await guardiansByStatus(tx, query.status, canDecidePickupGuardians.allows(actor) ? null : actor.userId)).map(pickupView),
  }));
}

const TARGET = { approve: 'approved', reject: 'rejected', deactivate: 'inactive' } as const;

/**
 * approve and reject decide a pending entry (wali kelas or admin); deactivate ends a pending or
 * approved one (also the parent). Repeating the action changes nothing (a retried request).
 */
export function decidePickupGuardian(actor: Actor, auditCtx: AuditContext, id: string, action: keyof typeof TARGET, now = new Date()): Promise<PickupGuardian> {
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockGuardian(tx, id);
    const rel = locked ? await relationTo(tx, locked.studentId, actor.userId) : undefined;
    if (!locked || !rel || !(rel.guardian || decides(actor, rel))) throw new NotFoundError(NO_ENTRY);
    const target = TARGET[action];
    if (action !== 'deactivate' && !decides(actor, rel)) throw new NotFoundError(NO_ENTRY);
    if (locked.status !== target) {
      const allowed = action === 'deactivate' ? locked.status === 'pending' || locked.status === 'approved' : locked.status === 'pending';
      if (!allowed) throw new ConflictError('Status penjemput ini sudah berubah. Muat ulang.', { reason: 'status', status: locked.status });
      await setStatus(tx, id, target, actor.userId, now);
      await audit(tx, auditCtx, `gate.pickup_guardian_${target}`, { type: 'pickup_guardian', id }, { before: { status: locked.status }, after: { status: target } });
    }
    const row = await findGuardian(tx, id);
    if (!row) throw new NotFoundError(NO_ENTRY);
    return pickupView(row);
  });
}

/** Looking at a photo is access to personal data: wali kelas, piket, admin, and audited. */
export function pickupPhotoLink(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, id: string): Promise<PickupPhotoLink> {
  return withTenant(scope(actor), async (tx) => {
    const row = await findGuardian(tx, id);
    const rel = row ? await relationTo(tx, row.studentId, actor.userId) : undefined;
    if (!row || !rel || !(rel.homeroom || canSeePickupPhotos.allows(actor))) throw new NotFoundError(NO_ENTRY);
    if (row.photoRemovedAt) throw new NotFoundError('Foto penjemput ini sudah dihapus.');
    await audit(tx, auditCtx, 'gate.pickup_photo_viewed', { type: 'pickup_guardian', id });
    const link = await storage.presignDownload({ key: row.photoKey, contentType: PICKUP_PHOTO_TYPE });
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  });
}

/** Removes photos PICKUP_PHOTO_RETENTION_DAYS after the entry was rejected or deactivated. */
export async function purgePickupPhotos(storage: ObjectStorage, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PICKUP_PHOTO_RETENTION_DAYS * 86_400_000);
  const due = await withPlatform((tx) => photosDueForRemoval(tx, cutoff));
  for (const row of due) {
    await storage.remove(row.photoKey);
    await withPlatform((tx) => markPhotoRemoved(tx, row.id, now));
  }
  return due.length;
}
