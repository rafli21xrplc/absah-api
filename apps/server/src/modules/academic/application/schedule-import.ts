import type { CreateScheduleImportRequest, CreateScheduleImportResponse, ScheduleImportPreview, ScheduleImportResult } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { canonicalJson } from '../../../shared/canonical-json';
import { withTenant } from '../../../shared/db';
import { ConflictError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canManageSchedule } from '../domain/policies';
import { planScheduleImport, scheduleSignature, type ScheduleImportPlan, type ScheduleRow } from '../domain/schedule-import';
import { ImportFormatError, normalizeName } from '../domain/student-import';
import { buildScheduleTemplate, readScheduleTemplate } from '../infrastructure/importers/schedule-template';
import { listClassesWithCounts } from '../infrastructure/registry-read-repo';
import {
  deleteOwnerSlots,
  insertSlots,
  insertSubjects,
  listSlots,
  listSubjects,
  listTeachers,
  lockSchedule,
  ownerKey,
  readPeriods,
  studentsOfOwners,
} from '../infrastructure/schedule-repo';
import { requireActiveYear } from './schedule';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const MODULE = 'schedule_imports';
const STALE_MESSAGE = 'Berkas atau data sekolah berubah sejak pratinjau. Muat ulang pratinjau sebelum menerapkan.';

/** The template, filled with the rombel lessons of the active year. */
export async function scheduleTemplate(actor: Actor): Promise<Buffer> {
  authorize(actor, canManageSchedule);
  const data = await withTenant(scope(actor), async (tx) => {
    const year = await requireActiveYear(tx);
    const lessons = (await listSlots(tx, year.id)).filter((s) => s.ownerType === 'class');
    return {
      lessons: lessons.map((l) => ({ className: l.ownerName, day: l.day, period: l.period, subject: l.subjectName, teacher: l.teacherName })),
      classes: (await listClassesWithCounts(tx, year.id)).map((c) => c.name),
      periods: await readPeriods(tx),
      subjects: (await listSubjects(tx)).map((s) => s.name),
      teachers: (await listTeachers(tx)).map((t) => t.name),
    };
  });
  return buildScheduleTemplate(data);
}

/** A presigned PUT for the filled template. The key is derived from the actor's school. */
export async function createScheduleImport(actor: Actor, storage: ObjectStorage, input: CreateScheduleImportRequest): Promise<CreateScheduleImportResponse> {
  authorize(actor, canManageSchedule);
  const uploadId = uuidv7();
  const upload = await storage.presignUpload({ key: storageKey(actor.schoolId, MODULE, uploadId), contentType: input.contentType, contentLength: input.fileSize });
  return { uploadId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

async function readRows(actor: Actor, storage: ObjectStorage, uploadId: string): Promise<ScheduleRow[]> {
  const file = await storage.read(storageKey(actor.schoolId, MODULE, uploadId));
  if (!file) throw new ConflictError('Berkas belum diunggah.', { reason: 'not_uploaded' });
  try {
    return await readScheduleTemplate(file);
  } catch (err) {
    if (err instanceof ImportFormatError) throw new ValidationError([{ path: 'file', message: err.message }], err.message);
    throw err;
  }
}

async function planAgainstDb(tx: Tx, rows: ScheduleRow[]): Promise<{ plan: ScheduleImportPlan; fingerprint: string; academicYearId: string }> {
  const year = await requireActiveYear(tx);
  const classes = await listClassesWithCounts(tx, year.id);
  const current = await listSlots(tx, year.id);
  const owners = [...current, ...classes.map((c) => ({ ownerType: 'class' as const, ownerId: c.id }))];
  const students = await studentsOfOwners(tx, year.id, owners);
  const plan = planScheduleImport(rows, {
    classes: classes.map((c) => ({ id: c.id, name: c.name })),
    subjects: await listSubjects(tx),
    teachers: await listTeachers(tx),
    periods: new Set((await readPeriods(tx)).map((p) => `${p.day}:${p.number}`)),
    kept: current,
    studentsOf: (o) => students.get(ownerKey(o)) ?? new Set(),
  });
  const fingerprint = createHash('sha256').update(canonicalJson(scheduleSignature(plan))).digest('base64url');
  return { plan, fingerprint, academicYearId: year.id };
}

const classNames = (plan: ScheduleImportPlan) => [...new Map(plan.lessons.map((l) => [l.ownerId, l.ownerName])).values()];

/** Dry run: nothing is written. */
export async function previewScheduleImport(actor: Actor, storage: ObjectStorage, uploadId: string): Promise<ScheduleImportPreview> {
  authorize(actor, canManageSchedule);
  const rows = await readRows(actor, storage, uploadId);
  const { plan, fingerprint } = await withTenant(scope(actor), (tx) => planAgainstDb(tx, rows));
  return { lessons: plan.lessons.length, classes: classNames(plan), newSubjects: plan.newSubjects, errors: plan.errors, fingerprint };
}

/**
 * Replaces every lesson of the rombel in the file, in one transaction under the schedule lock,
 * after planning again: refused when the result differs from the preview or has errors.
 */
export async function commitScheduleImport(
  actor: Actor,
  auditCtx: AuditContext,
  storage: ObjectStorage,
  uploadId: string,
  fingerprint: string,
  logger?: Logger,
): Promise<ScheduleImportResult> {
  authorize(actor, canManageSchedule);
  const rows = await readRows(actor, storage, uploadId);
  const result = await withTenant(scope(actor), async (tx) => {
    await lockSchedule(tx, actor.schoolId);
    const { plan, fingerprint: current, academicYearId } = await planAgainstDb(tx, rows);
    if (current !== fingerprint) throw new ConflictError(STALE_MESSAGE, { reason: 'stale_preview' });
    if (plan.errors.length > 0) throw new ConflictError('Perbaiki baris yang bermasalah sebelum menerapkan.', { reason: 'has_errors' });

    const created = await insertSubjects(tx, actor.schoolId, plan.newSubjects.map((name) => ({ name })));
    const subjectIds = new Map(created.map((s) => [normalizeName(s.name), s.id]));
    const subjectOf = (l: ScheduleImportPlan['lessons'][number]) => {
      const id = l.subjectId ?? subjectIds.get(normalizeName(l.subjectName));
      if (!id) throw new Error(`subject ${l.subjectName} was not created`);
      return id;
    };
    const removed = await deleteOwnerSlots(tx, academicYearId, 'class', plan.classIds);
    await insertSlots(
      tx,
      plan.lessons.map((l) => ({
        schoolId: actor.schoolId,
        academicYearId,
        ownerType: l.ownerType,
        ownerId: l.ownerId,
        day: l.day,
        period: l.period,
        subjectId: subjectOf(l),
        teacherId: l.teacherId,
      })),
    );
    const summary = { lessons: plan.lessons.length, classes: classNames(plan), newSubjects: plan.newSubjects };
    await audit(tx, auditCtx, 'schedule.imported', { type: 'schedule_import', id: uploadId }, { after: { ...summary, removedLessons: removed } });
    return summary;
  });
  await storage.remove(storageKey(actor.schoolId, MODULE, uploadId)).catch((err: unknown) => logger?.warn({ err, uploadId }, 'schedule file not removed'));
  return result;
}
