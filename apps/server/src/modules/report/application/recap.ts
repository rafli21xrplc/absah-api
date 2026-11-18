import type { AttendanceCounts, ClassStream, ClassRecapDetail, ClassRecapList, ReportPeriodQuery, ReportSemesterList, SessionCompliance } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { addCounts, emptyCounts, recapTotals, summarizeCompliance } from '../domain/recap';
import { canReadAllRecaps, canReadCompliance } from '../domain/policies';
import { activeClasses, activeSemesters, classCounts, complianceRows, findClass, memberNames, studentCounts } from '../infrastructure/recap-repo';

const NOT_ALLOWED = 'Rekap untuk wali kelas dan pimpinan sekolah.';

const tenant = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const countsOf = (row: AttendanceCounts): AttendanceCounts => ({ H: row.H, T: row.T, S: row.S, I: row.I, A: row.A });
const person = (id: string | null, name: string | null) => (id ? { id, name: name ?? 'Tanpa nama' } : null);

export function listSemesters(actor: Actor): Promise<ReportSemesterList> {
  return withTenant(tenant(actor), async (tx) => ({ items: await activeSemesters(tx) }));
}

/** RKP-01: rekap per rombel. Managers see every rombel of the active year, a wali kelas their own. */
export function classRecaps(actor: Actor, { from, to }: ReportPeriodQuery, stream?: ClassStream): Promise<ClassRecapList> {
  return withTenant(tenant(actor), async (tx) => {
    const all = canReadAllRecaps.allows(actor);
    // A wali kelas without a rombel is refused whatever the filter; the filter may then leave none.
    if (!all && (await activeClasses(tx, actor.userId)).length === 0) throw new ForbiddenError(NOT_ALLOWED);
    const classes = await activeClasses(tx, all ? null : actor.userId, stream);
    const counts = new Map((await classCounts(tx, classes.map((c) => c.id), from, to)).map((r) => [r.classId, r]));
    return {
      from,
      to,
      items: classes.map((c) => {
        const row = counts.get(c.id);
        return {
          id: c.id,
          name: c.name,
          grade: c.grade,
          stream: c.stream,
          homeroom: person(c.homeroomId, c.homeroomName),
          students: row?.students ?? 0,
          ...recapTotals(row ? countsOf(row) : emptyCounts()),
        };
      }),
    };
  });
}

/** RKP-01/02: rekap per siswa of one rombel (any year, so last year's rekap stays readable). */
export function classRecap(actor: Actor, classId: string, { from, to }: ReportPeriodQuery): Promise<ClassRecapDetail> {
  return withTenant(tenant(actor), async (tx) => {
    const cls = await findClass(tx, classId);
    const allowed = cls && (canReadAllRecaps.allows(actor) || cls.homeroomId === actor.userId);
    if (!allowed) {
      // Same answer for unknown rombel and other people's rombel, unless the caller may read none.
      if (canReadAllRecaps.allows(actor) || (await activeClasses(tx, actor.userId)).length > 0) throw new NotFoundError('Rombel tidak ditemukan.');
      throw new ForbiddenError(NOT_ALLOWED);
    }
    const totals = emptyCounts();
    const items = (await studentCounts(tx, classId, from, to)).map((r) => {
      const counts = countsOf(r);
      addCounts(totals, counts);
      return { enrollmentId: r.enrollmentId, studentId: r.studentId, name: r.name, nisn: r.nisn, localId: r.localId, active: r.active, ...recapTotals(counts) };
    });
    return {
      from,
      to,
      class: { id: cls.id, name: cls.name, grade: cls.grade, homeroom: person(cls.homeroomId, cls.homeroomName) },
      items,
      totals: recapTotals(totals),
    };
  });
}

/** RKP-04: who fills their sessions, per teacher and per day. */
export function sessionCompliance(actor: Actor, { from, to }: ReportPeriodQuery): Promise<SessionCompliance> {
  if (!canReadCompliance.allows(actor)) throw new ForbiddenError('Laporan pengisian sesi untuk wakasek dan kepala sekolah.');
  return withTenant(tenant(actor), async (tx) => {
    const summary = summarizeCompliance(await complianceRows(tx, from, to));
    const ids = summary.teachers.flatMap((t) => (t.teacherId ? [t.teacherId] : []));
    const names = await memberNames(tx, ids);
    return {
      from,
      to,
      totals: summary.totals,
      teachers: summary.teachers.map(({ teacherId, ...counts }) => ({ teacher: person(teacherId, teacherId ? (names.get(teacherId) ?? null) : null), ...counts })),
      days: summary.days,
    };
  });
}
