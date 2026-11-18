import { EXPORT_RETENTION_DAYS, type CreateExportRequest, type ExportDownload, type ExportJob, type ExportJobList, type ExportTarget } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { defineConsumer, emit, type Consumer } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canReadAllRecaps } from '../domain/policies';
import { EXPORT_CONTENT_TYPES, exportFileName, semesterStudentsByClass, type SemesterRecap } from '../domain/semester-recap';
import { exporterFor } from '../infrastructure/exporters';
import {
  classesOfYear,
  enrollmentDays,
  expireJobs,
  findClassOfYear,
  findJob,
  findSemester,
  finishJob,
  insertJob,
  listJobs,
  principalName,
  schoolInfo,
  studentsOfClass,
  type ExportJobRow,
} from '../infrastructure/export-repo';

const tenant = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

function view(row: ExportJobRow): ExportJob {
  return {
    id: row.id,
    target: row.target,
    format: row.format,
    semester: { id: row.semesterId, academicYear: row.academicYear, number: row.semesterNumber },
    class: row.classId && row.className ? { id: row.classId, name: row.className } : null,
    stream: row.stream,
    status: row.status,
    fileName: row.fileName,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * RKP-02/03: queue a semester rekap file. Managers may export the whole year; a wali kelas only their
 * rombel. The worker builds it (export.requested), so a 900-student file never blocks the API.
 */
export function requestExport(actor: Actor, auditCtx: AuditContext, target: ExportTarget, input: CreateExportRequest): Promise<ExportJob> {
  const all = canReadAllRecaps.allows(actor);
  if (!all && !input.classId) throw new ForbiddenError('Ekspor semua rombel untuk pimpinan sekolah dan operator.');
  if (!exporterFor(target)) throw new ConflictError(`Ekspor untuk ${target.toUpperCase()} belum tersedia.`, { reason: 'target_unavailable' });
  return withTenant(tenant(actor), async (tx) => {
    const semester = await findSemester(tx, input.semesterId);
    if (!semester) throw new NotFoundError('Semester tidak ditemukan.');
    if (input.classId) {
      const cls = await findClassOfYear(tx, input.classId, semester.academicYearId);
      if (!cls || (!all && cls.homeroomId !== actor.userId)) throw new NotFoundError('Rombel tidak ditemukan pada tahun ajaran semester ini.');
    }
    const id = uuidv7();
    await insertJob(tx, {
      id,
      schoolId: actor.schoolId,
      target,
      format: input.format,
      semesterId: semester.id,
      classId: input.classId ?? null,
      stream: input.stream ?? null,
      fileKey: storageKey(actor.schoolId, 'exports', id),
      requestedBy: actor.userId,
    });
    await audit(tx, auditCtx, 'export.requested', { type: 'export_job', id }, { after: { target, format: input.format, semesterId: semester.id, classId: input.classId ?? null, stream: input.stream ?? null } });
    await emit(tx, 'export.requested', { exportJobId: id });
    const row = await findJob(tx, id);
    if (!row) throw new Error('export job vanished');
    return view(row);
  });
}

export function listExports(actor: Actor): Promise<ExportJobList> {
  return withTenant(tenant(actor), async (tx) => ({ items: (await listJobs(tx, actor.userId)).map(view) }));
}

/** Only the person who asked sees an export: the file holds a whole rombel's data. */
async function ownJob(tx: Tx, actor: Actor, id: string) {
  const row = await findJob(tx, id);
  if (!row || row.requestedBy !== actor.userId) throw new NotFoundError('Ekspor tidak ditemukan.');
  return row;
}

export function getExport(actor: Actor, id: string): Promise<ExportJob> {
  return withTenant(tenant(actor), async (tx) => view(await ownJob(tx, actor, id)));
}

export function downloadExport(actor: Actor, id: string, storage: ObjectStorage): Promise<ExportDownload> {
  return withTenant(tenant(actor), async (tx) => {
    const row = await ownJob(tx, actor, id);
    if (row.status === 'expired') throw new ConflictError(`Berkas sudah dihapus setelah ${EXPORT_RETENTION_DAYS} hari. Buat ekspor baru.`, { reason: 'expired' });
    if (row.status !== 'done' || !row.fileName) throw new ConflictError('Berkas belum siap.', { reason: 'not_ready' });
    const link = await storage.presignDownload({ key: row.fileKey, contentType: EXPORT_CONTENT_TYPES[row.format], fileName: row.fileName });
    return { url: link.url, fileName: row.fileName, expiresAt: link.expiresAt.toISOString() };
  });
}

/** Loads one semester's rekap in the shape exporters take. */
async function semesterRecap(tx: Tx, schoolId: string, job: ExportJobRow): Promise<{ recap: SemesterRecap; className: string | null }> {
  const [school, semester] = await Promise.all([schoolInfo(tx, schoolId), findSemester(tx, job.semesterId)]);
  if (!school || !semester) throw new Error('school or semester missing');
  const students = job.classId ? await studentsOfClass(tx, job.classId, semester.startsOn, semester.endsOn) : undefined;
  const rows = await enrollmentDays(tx, semester.academicYearId, semester.startsOn, semester.endsOn, students);
  const byClass = semesterStudentsByClass(rows.map((r) => ({ ...r, counts: { H: r.H, T: r.T, S: r.S, I: r.I, A: r.A } })));
  const classes = await classesOfYear(tx, semester.academicYearId, job.classId, job.stream);
  return {
    className: job.className ?? (job.stream ? `jurusan ${job.stream.toUpperCase()}` : null),
    recap: {
      school: { name: school.name, npsn: school.npsn },
      semester: { academicYear: semester.academicYear, number: semester.number, startsOn: semester.startsOn, endsOn: semester.endsOn },
      principalName: await principalName(tx),
      signedOn: schoolDate(school.timezone),
      classes: classes.map((c) => ({ name: c.name, grade: c.grade, homeroomName: c.homeroomName, students: byClass.get(c.id) ?? [] })),
    },
  };
}

/** Worker: builds the file, stores it under the job's key, marks the job done (or failed on the last try). */
export function exportConsumer(storage: ObjectStorage) {
  return defineConsumer({
    name: 'report_build_export',
    event: 'export.requested',
    retryLimit: 2,
    async handle(tx, event, delivery) {
      const job = await findJob(tx, event.payload.exportJobId, true);
      if (job?.status !== 'queued') return;
      try {
        // Savepoint: a database error inside still lets the last attempt record the failure.
        await tx.transaction(async (sp) => {
          const exporter = exporterFor(job.target);
          if (!exporter) throw new Error(`no exporter for ${job.target}`);
          const { recap, className } = await semesterRecap(sp, event.schoolId, job);
          await storage.write(job.fileKey, await exporter.build(recap, job.format), EXPORT_CONTENT_TYPES[job.format]);
          await finishJob(sp, job.id, { status: 'done', fileName: exportFileName(recap, className, job.format) });
        });
      } catch (err) {
        if (!delivery.lastAttempt) throw err;
        await finishJob(tx, job.id, { status: 'failed', error: 'Berkas gagal dibuat. Coba buat ekspor lagi.' });
      }
    },
  });
}

export function reportConsumers(storage: ObjectStorage): Consumer[] {
  return [exportConsumer(storage)];
}

/** Removes finished files after EXPORT_RETENTION_DAYS (withPlatform: maintenance across schools). */
export async function purgeOldExports(storage: ObjectStorage, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPORT_RETENTION_DAYS * 86_400_000);
  const expired = await withPlatform((tx) => expireJobs(tx, cutoff));
  for (const r of expired) await storage.remove(r.fileKey);
  return expired.length;
}
