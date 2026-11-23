import { type CreateImportRequest, type StudentImportResponse } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { authorize } from '../../../shared/authorize';
import { canonicalJson } from '../../../shared/canonical-json';
import { hashValue } from '../../../shared/crypto';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { storageKey, type ObjectStorage, type PresignedUpload } from '../../../shared/storage';
import { parseClassName } from '../domain/class-name';
import { defaultAcademicYear, describePlan, planSignature } from '../domain/import-preview';
import { canManageStudentData } from '../domain/policies';
import { ImportFormatError, type ImportIssue, type ImportSource } from '../domain/student-import';
import { planStudentImport, type IncomingStudent } from '../domain/student-matching';
import { importerFor } from '../infrastructure/importers';
import { lockSchoolProfile } from '../infrastructure/school-settings-repo';
import {
  decodePreview,
  encodePreview,
  findActiveAcademicYear,
  findImport,
  insertImport,
  listImports,
  loadExistingStudents,
  updateImport,
  type StudentImportRow,
} from '../infrastructure/student-import-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

function toResponse(row: Omit<StudentImportRow, 'preview' | 'fingerprint' | 'fileKey' | 'fileSize' | 'createdBy' | 'parsedAt' | 'committedBy' | 'schoolId'> & { preview?: StudentImportRow['preview'] }): StudentImportResponse {
  const doc = row.preview ? decodePreview(row.preview) : null;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    fileName: row.fileName,
    academicYear: row.academicYear,
    error: row.error,
    counts: row.counts,
    items: doc?.items ?? [],
    issues: (doc?.issues ?? []).map((i) => ({ row: i.row, field: i.field ?? null, message: i.message, severity: i.severity })),
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
  };
}

/** Creates the import and a presigned PUT for the file. The key is built from the actor's school. */
export async function createStudentImport(
  actor: Actor,
  storage: ObjectStorage,
  source: ImportSource,
  input: CreateImportRequest,
): Promise<{ import: StudentImportResponse; upload: Omit<PresignedUpload, 'expiresAt'> & { expiresAt: string } }> {
  authorize(actor, canManageStudentData);
  const id = uuidv7();
  const fileKey = storageKey(actor.schoolId, 'imports', id);
  const row = await withTenant(scope(actor), (tx) =>
    insertImport(tx, { id, schoolId: actor.schoolId, source, fileKey, fileName: input.fileName, fileSize: input.fileSize, createdBy: actor.userId }),
  );
  const upload = await storage.presignUpload({ key: fileKey, contentType: input.contentType, contentLength: input.fileSize });
  return { import: toResponse(row), upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

/**
 * Queues parsing once the browser has uploaded the file, or again to refresh a ready preview whose
 * data changed. Calling it while parsing changes nothing.
 */
export async function requestImportParse(actor: Actor, importId: string): Promise<StudentImportResponse> {
  authorize(actor, canManageStudentData);
  return withTenant(scope(actor), async (tx) => {
    const row = await findImport(tx, importId, { lock: true });
    if (!row) throw new NotFoundError('Import tidak ditemukan.');
    if (row.status === 'committed') throw new ConflictError('Import ini sudah diterapkan.');
    if (row.status === 'awaiting_upload' || row.status === 'failed' || row.status === 'ready') {
      await updateImport(tx, row.id, { status: 'parsing', error: null });
      await emit(tx, 'student_import.uploaded', { importId: row.id });
      return toResponse({ ...row, status: 'parsing', error: null, preview: null });
    }
    return toResponse(row);
  });
}

export async function getStudentImport(actor: Actor, importId: string): Promise<StudentImportResponse> {
  authorize(actor, canManageStudentData);
  const row = await withTenant(scope(actor), (tx) => findImport(tx, importId));
  if (!row) throw new NotFoundError('Import tidak ditemukan.');
  return toResponse(row);
}

export async function listStudentImports(actor: Actor): Promise<{ items: StudentImportResponse[] }> {
  authorize(actor, canManageStudentData);
  const rows = await withTenant(scope(actor), (tx) => listImports(tx));
  return { items: rows.map((r) => toResponse(r)) };
}

/** Rombel names without a readable grade become warnings: the student is kept, the class is not. */
function checkClassNames(rows: IncomingStudent[], issues: ImportIssue[]): IncomingStudent[] {
  return rows.map((r) => {
    if (r.className === null || parseClassName(r.className)) return r;
    issues.push({ row: r.row, field: 'className', message: `Kelas pada rombel "${r.className}" tidak terbaca; rombel tidak diubah.`, severity: 'warning' });
    return { ...r, className: null };
  });
}

/** Plans an import against the current data. Used by parse and again at commit. */
export async function planAgainstDb(tx: Tx, rows: IncomingStudent[]) {
  const year = await findActiveAcademicYear(tx);
  const existing = await loadExistingStudents(tx, year?.id ?? null);
  const plan = planStudentImport(existing, rows);
  const fingerprint = createHash('sha256').update(canonicalJson(planSignature(plan))).digest('base64url');
  return { plan, fingerprint, year };
}

/**
 * Worker side (outbox consumer): reads the uploaded file, parses it and stores the preview.
 * A bad file marks the import failed with a message for staff; other errors retry.
 */
export async function parseStudentImport(tx: Tx, storage: ObjectStorage, importId: string): Promise<void> {
  const row = await findImport(tx, importId, { lock: true });
  if (!row || row.status !== 'parsing') return;
  const fail = (error: string) => updateImport(tx, row.id, { status: 'failed', error, preview: null, counts: null, fingerprint: null });

  const file = await storage.read(row.fileKey);
  if (!file) return fail('Berkas belum terunggah. Unggah ulang berkasnya.');
  let parsed;
  try {
    parsed = await importerFor(row.source).parse(file);
  } catch (err) {
    if (err instanceof ImportFormatError) return fail(err.message);
    throw err;
  }

  const issues = [...parsed.issues];
  const rows = checkClassNames(
    parsed.rows.map((r) => ({ ...r, nikHash: r.nik ? hashValue(r.nik) : null })),
    issues,
  );
  const { plan, fingerprint, year } = await planAgainstDb(tx, rows);
  const { counts, items } = describePlan(plan, issues);
  const profile = await lockSchoolProfile(tx, row.schoolId);
  const academicYear = year?.name ?? defaultAcademicYear(schoolDate(profile?.timezone ?? 'Asia/Jakarta')).name;

  await updateImport(tx, row.id, {
    status: 'ready',
    error: null,
    counts,
    preview: encodePreview({ rows, issues, items }),
    fingerprint,
    academicYear,
    parsedAt: new Date(),
  });
}
