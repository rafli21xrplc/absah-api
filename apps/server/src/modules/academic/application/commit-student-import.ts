import type { ClassStream, StudentImportResponse } from '@absah/contracts';
import type { Tx } from '@absah/db';
import type { Logger } from 'pino';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { addDays, schoolDate } from '../../../shared/school-date';
import type { ObjectStorage } from '../../../shared/storage';
import { parseClassName } from '../domain/class-name';
import { defaultAcademicYear } from '../domain/import-preview';
import { canManageStudentData } from '../domain/policies';
import type { MatchedStudent } from '../domain/student-matching';
import { lockSchoolProfile } from '../infrastructure/school-settings-repo';
import { decodePreview, encodePreview, findActiveAcademicYear, findImport, updateImport } from '../infrastructure/student-import-repo';
import {
  activateAcademicYear,
  activeEnrollment,
  addGuardians,
  clearMissing,
  createAcademicYear,
  ensureClasses,
  findAcademicYearByName,
  flagMissing,
  insertEnrollment,
  insertStudent,
  lockStudentImports,
  studentValues,
  updateEnrollment,
  updateStudent,
} from '../infrastructure/student-registry-repo';
import { getStudentImport, planAgainstDb } from './student-import';

export const STALE_IMPORT_MESSAGE = 'Data siswa berubah sejak pratinjau dibuat. Muat ulang pratinjau, periksa, lalu terapkan lagi.';

async function ensureAcademicYear(tx: Tx, schoolId: string, today: string) {
  const active = await findActiveAcademicYear(tx);
  if (active) return active;
  const year = defaultAcademicYear(today);
  const existing = await findAcademicYearByName(tx, year.name);
  if (existing) {
    await activateAcademicYear(tx, existing.id);
    return existing;
  }
  return createAcademicYear(tx, schoolId, year);
}

/** Applies the changed fields of a matched student; class moves close the old enrollment. */
async function applyChange(tx: Tx, ctx: { schoolId: string; yearId: string; today: string; classIds: Map<string, string> }, m: MatchedStudent) {
  const values = studentValues(m.incoming);
  const patch: Partial<typeof values> = {};
  for (const change of m.changes) {
    if (change.field === 'className') continue;
    if (change.field === 'nik') Object.assign(patch, { nik: values.nik, nikHash: values.nikHash });
    else Object.assign(patch, { [change.field]: values[change.field] });
  }
  await updateStudent(tx, m.studentId, patch);

  const className = m.incoming.className;
  const classId = className ? ctx.classIds.get(className) : undefined;
  if (!classId || !m.changes.some((c) => c.field === 'className')) return;
  const current = await activeEnrollment(tx, m.studentId, ctx.yearId);
  if (current && current.startsOn >= ctx.today) {
    await updateEnrollment(tx, current.id, { classId }); // started today: no history to keep
    return;
  }
  if (current) await updateEnrollment(tx, current.id, { status: 'class_changed', endsOn: addDays(ctx.today, -1) });
  await insertEnrollment(tx, { schoolId: ctx.schoolId, studentId: m.studentId, classId, academicYearId: ctx.yearId, startsOn: ctx.today });
}

/**
 * Commits a ready import in one transaction: creates the academic year and rombel when needed,
 * new students with enrollments and guardians, applies changes, flags missing students "calon
 * keluar" (never deletes). Committing again returns the result. If the data changed since the
 * preview, nothing is written (409) and the preview must be refreshed with POST /parse.
 */
export async function commitStudentImport(
  actor: Actor,
  auditCtx: AuditContext,
  storage: ObjectStorage,
  importId: string,
  logger?: Logger,
): Promise<StudentImportResponse> {
  authorize(actor, canManageStudentData);
  const fileKey = await withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    await lockStudentImports(tx, actor.schoolId);
    const row = await findImport(tx, importId, { lock: true });
    if (!row) throw new NotFoundError('Import tidak ditemukan.');
    if (row.status === 'committed') return null;
    if (row.status !== 'ready' || !row.preview) throw new ConflictError('Pratinjau import belum siap.');

    const doc = decodePreview(row.preview);
    const { plan, fingerprint } = await planAgainstDb(tx, doc.rows);
    if (fingerprint !== row.fingerprint) throw new ConflictError(STALE_IMPORT_MESSAGE, { reason: 'stale_preview' });

    const profile = await lockSchoolProfile(tx, actor.schoolId);
    const today = schoolDate(profile?.timezone ?? 'Asia/Jakarta');
    const year = await ensureAcademicYear(tx, actor.schoolId, today);

    const matched = [...plan.changed, ...plan.unchanged];
    const wanted = new Map<string, { grade: number; stream: ClassStream | null }>();
    for (const r of [...plan.created, ...matched.map((m) => m.incoming)]) {
      const parsed = r.className ? parseClassName(r.className) : null;
      if (r.className && parsed) wanted.set(r.className, parsed);
    }
    const { ids: classIds, created: classesCreated } = await ensureClasses(tx, actor.schoolId, year.id, wanted);
    const ctx = { schoolId: actor.schoolId, yearId: year.id, today, classIds };

    let guardiansAdded = 0;
    for (const r of plan.created) {
      const studentId = await insertStudent(tx, actor.schoolId, r);
      const classId = r.className ? classIds.get(r.className) : undefined;
      if (classId) await insertEnrollment(tx, { schoolId: actor.schoolId, studentId, classId, academicYearId: year.id, startsOn: today });
      guardiansAdded += await addGuardians(tx, actor.schoolId, studentId, r.guardians);
    }
    for (const m of plan.changed) await applyChange(tx, ctx, m);
    for (const m of matched) {
      // A student without an active enrollment this year who now has a rombel gets one.
      const classId = m.incoming.className ? classIds.get(m.incoming.className) : undefined;
      if (classId && !(await activeEnrollment(tx, m.studentId, year.id))) {
        await insertEnrollment(tx, { schoolId: actor.schoolId, studentId: m.studentId, classId, academicYearId: year.id, startsOn: today });
      }
      guardiansAdded += await addGuardians(tx, actor.schoolId, m.studentId, m.incoming.guardians);
    }
    await clearMissing(tx, year.id, matched.map((m) => m.studentId));
    await flagMissing(tx, plan.missing.flatMap((s) => (s.enrollment ? [s.enrollment.id] : [])));

    await updateImport(tx, row.id, {
      status: 'committed',
      committedAt: new Date(),
      committedBy: actor.userId,
      academicYear: year.name,
      // The NIKs are no longer needed: keep only what the preview shows.
      preview: encodePreview({ rows: [], issues: doc.issues, items: doc.items }),
    });
    await audit(tx, auditCtx, 'student_import.committed', { type: 'student_import', id: row.id }, {
      after: { counts: row.counts, academicYear: year.name, classesCreated, guardiansAdded },
    });
    return row.fileKey;
  });

  if (fileKey) {
    // The file holds personal data: drop it once committed. A failure is retried by the cleanup job.
    await storage.remove(fileKey).catch((err: unknown) => logger?.warn({ err, importId }, 'import file not removed'));
  }
  return getStudentImport(actor, importId);
}
