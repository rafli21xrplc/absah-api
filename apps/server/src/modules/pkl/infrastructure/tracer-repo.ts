import type { ClassStream, TracerSource, TracerStatus } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

const al = schema.tracerAlumni;
const rs = schema.tracerResponses;

export interface AlumniFilter {
  id?: string;
  ids?: readonly string[];
  graduationYear?: number;
  stream?: ClassStream;
  answered?: 'yes' | 'no';
  q?: string;
}

/** Alumni with their answer, newest angkatan first. */
export function alumniRows(tx: Tx, f: AlumniFilter = {}) {
  const where: SQL[] = [];
  if (f.id) where.push(eq(al.id, f.id));
  if (f.ids) where.push(inArray(al.id, [...f.ids]));
  if (f.graduationYear) where.push(eq(al.graduationYear, f.graduationYear));
  if (f.stream) where.push(eq(al.stream, f.stream));
  if (f.answered === 'yes') where.push(isNotNull(rs.id));
  if (f.answered === 'no') where.push(isNull(rs.id));
  if (f.q) where.push(or(ilike(al.name, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`), eq(al.nisn, f.q)) as SQL);
  return tx
    .select({
      id: al.id,
      name: al.name,
      nisn: al.nisn,
      graduationYear: al.graduationYear,
      stream: al.stream,
      phone: al.phone,
      status: rs.status,
      organization: rs.organization,
      position: rs.position,
      source: rs.source,
      answeredAt: rs.answeredAt,
    })
    .from(al)
    .leftJoin(rs, eq(rs.alumnusId, al.id))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(al.graduationYear), asc(al.name), asc(al.id));
}
export type AlumniRow = Awaited<ReturnType<typeof alumniRows>>[number];

export async function insertAlumni(tx: Tx, rows: { id: string; schoolId: string; name: string; nisn: string | null; graduationYear: number; stream: ClassStream | null; studentId: string | null; phone: string | null; createdBy: string }[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(al).values(rows.map((r) => ({ ...r, phone: r.phone === null ? null : sensitive(r.phone) })));
}

/** One answer per alumnus; answering again replaces it. */
export async function upsertResponse(tx: Tx, input: { id: string; schoolId: string; alumnusId: string; status: TracerStatus; organization: string | null; position: string | null; source: TracerSource; enteredBy: string | null }): Promise<void> {
  const values = {
    status: input.status,
    organization: input.organization === null ? null : sensitive(input.organization),
    position: input.position === null ? null : sensitive(input.position),
    source: input.source,
    enteredBy: input.enteredBy,
  };
  await tx
    .insert(rs)
    .values({ id: input.id, schoolId: input.schoolId, alumnusId: input.alumnusId, ...values })
    .onConflictDoUpdate({ target: rs.alumnusId, set: { ...values, answeredAt: sql`now()`, updatedAt: sql`now()` } });
}

export async function findClass(tx: Tx, classId: string) {
  const [row] = await tx.select({ id: schema.classes.id, stream: schema.classes.stream }).from(schema.classes).where(eq(schema.classes.id, classId));
  return row;
}

/** Students with an active enrollment in the rombel. */
export function activeStudentsOfClass(tx: Tx, classId: string) {
  const e = schema.enrollments;
  return tx
    .select({ id: schema.students.id, name: schema.students.name, nisn: schema.students.nisn })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .where(and(eq(e.classId, classId), eq(e.status, 'active')))
    .orderBy(asc(schema.students.name));
}

export async function alumniStudentIds(tx: Tx): Promise<Set<string>> {
  const rows = await tx.select({ id: al.studentId }).from(al).where(isNotNull(al.studentId));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

const tl = schema.tracerLinks;

/** The link with this token hash, locked when the caller is about to write through it. */
export async function findTracerLink(tx: Tx, tokenHash: string, lock: boolean) {
  const query = tx.select().from(tl).where(eq(tl.tokenHash, tokenHash));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export const markTracerLinkOpened = (tx: Tx, id: string, at: Date) => tx.update(tl).set({ lastOpenedAt: at }).where(eq(tl.id, id));

/** What the capability resolver needs, and the name the page shows. */
export async function schoolProfile(tx: Tx, schoolId: string) {
  const s = schema.schools;
  const [row] = await tx.select({ id: s.id, name: s.name, level: s.level, isMadrasah: s.isMadrasah, timezone: s.timezone }).from(s).where(eq(s.id, schoolId));
  return row;
}

/** Rombel of the active year with their active students, for the "copy from rombel" picker. */
export function tracerClasses(tx: Tx) {
  const e = schema.enrollments;
  return tx
    .select({ id: schema.classes.id, name: schema.classes.name, grade: schema.classes.grade, stream: schema.classes.stream, activeStudents: sql<number>`count(${e.id}) filter (where ${e.status} = 'active')::int` })
    .from(schema.classes)
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, schema.classes.academicYearId), eq(schema.academicYears.isActive, true)))
    .leftJoin(e, eq(e.classId, schema.classes.id))
    .groupBy(schema.classes.id)
    .orderBy(desc(schema.classes.grade), asc(schema.classes.name), asc(schema.classes.id));
}
