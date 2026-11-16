import { schema, SensitiveText, type Tx } from '@absah/db';
import { and, desc, eq } from 'drizzle-orm';
import type { ImportIssue } from '../domain/student-import';
import type { ExistingStudent, IncomingStudent } from '../domain/student-matching';
import type { ImportPreviewItem } from '@absah/contracts';

export type StudentImportRow = typeof schema.studentImports.$inferSelect;

/** Decrypted preview document: parsed rows (with NIK) for the commit, lines for the screen. */
export interface PreviewDocument {
  rows: IncomingStudent[];
  issues: ImportIssue[];
  items: ImportPreviewItem[];
}

export async function insertImport(tx: Tx, values: typeof schema.studentImports.$inferInsert): Promise<StudentImportRow> {
  const [row] = await tx.insert(schema.studentImports).values(values).returning();
  if (!row) throw new Error('insert student_imports returned nothing');
  return row;
}

export async function findImport(tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<StudentImportRow | undefined> {
  const query = tx.select().from(schema.studentImports).where(eq(schema.studentImports.id, id));
  const [row] = await (options.lock ? query.for('update') : query);
  return row;
}

export async function listImports(tx: Tx, limit = 20) {
  const t = schema.studentImports;
  // preview stays encrypted: lists never need it.
  return tx
    .select({
      id: t.id,
      source: t.source,
      status: t.status,
      fileName: t.fileName,
      academicYear: t.academicYear,
      error: t.error,
      counts: t.counts,
      createdAt: t.createdAt,
      committedAt: t.committedAt,
    })
    .from(t)
    .orderBy(desc(t.createdAt))
    .limit(limit);
}

export async function updateImport(tx: Tx, id: string, values: Partial<typeof schema.studentImports.$inferInsert>): Promise<void> {
  await tx.update(schema.studentImports).set(values).where(eq(schema.studentImports.id, id));
}

export const encodePreview = (doc: PreviewDocument) => new SensitiveText(JSON.stringify(doc));
export const decodePreview = (value: SensitiveText) => JSON.parse(value.reveal()) as PreviewDocument;

export async function findActiveAcademicYear(tx: Tx) {
  const [row] = await tx.select().from(schema.academicYears).where(eq(schema.academicYears.isActive, true));
  return row;
}

/** Students of the school with their active enrollment in the given year (NIK not decrypted). */
export async function loadExistingStudents(tx: Tx, academicYearId: string | null): Promise<ExistingStudent[]> {
  const s = schema.students;
  const columns = {
    id: s.id,
    name: s.name,
    nisn: s.nisn,
    nikHash: s.nikHash,
    localId: s.localId,
    gender: s.gender,
    birthPlace: s.birthPlace,
    birthDate: s.birthDate,
  };
  if (!academicYearId) {
    const rows = await tx.select(columns).from(s);
    return rows.map((r) => ({ ...r, enrollment: null }));
  }
  const e = schema.enrollments;
  const c = schema.classes;
  const rows = await tx
    .select({ ...columns, enrollmentId: e.id, className: c.name, missingSince: e.missingSince })
    .from(s)
    .leftJoin(e, and(eq(e.studentId, s.id), eq(e.status, 'active'), eq(e.academicYearId, academicYearId)))
    .leftJoin(c, eq(c.id, e.classId));
  return rows.map(({ enrollmentId, className, missingSince, ...student }) => ({
    ...student,
    enrollment: enrollmentId && className ? { id: enrollmentId, className, missingSince } : null,
  }));
}
