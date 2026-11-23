import type { CreateCharacterReportRequest, ExportJob } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { storageKey } from '../../../shared/storage';
import { activityTallies, habitTallies } from '../../activity';
import { pointTotalsInRange } from '../../student-affairs';
import { characterRoster, mergeActivities, presentRateOf, sumHabits, type CharacterReport } from '../domain/character-report';
import { canReadAllRecaps } from '../domain/policies';
import { classesOfYear, enrollmentDays, findClassOfYear, findJob, findSemester, insertJob, principalName, schoolInfo, studentsOfClass, type ExportJobRow } from '../infrastructure/export-repo';
import { view } from './export-view';

/**
 * KEG-04: queue the semester character report of one rombel. Managers (kepsek, wakasek, admin) may ask for any rombel, a wali kelas
 * only for theirs; the job is an ordinary export, so it is listed, polled and downloaded like the rekap files.
 */
export function requestCharacterReport(actor: Actor, auditCtx: AuditContext, input: CreateCharacterReportRequest): Promise<ExportJob> {
  const all = canReadAllRecaps.allows(actor);
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const semester = await findSemester(tx, input.semesterId);
    if (!semester) throw new NotFoundError('Semester tidak ditemukan.');
    const cls = await findClassOfYear(tx, input.classId, semester.academicYearId);
    if (!cls) throw new NotFoundError('Rombel tidak ditemukan pada tahun ajaran semester ini.');
    if (!all && cls.homeroomId !== actor.userId) throw new ForbiddenError('Rapor karakter hanya untuk wali kelas rombel ini dan pimpinan sekolah.');
    const id = uuidv7();
    await insertJob(tx, { id, schoolId: actor.schoolId, target: 'rapor_karakter', format: 'pdf', semesterId: semester.id, classId: cls.id, stream: null, fileKey: storageKey(actor.schoolId, 'exports', id), requestedBy: actor.userId });
    await audit(tx, auditCtx, 'export.requested', { type: 'export_job', id }, { after: { target: 'rapor_karakter', format: 'pdf', semesterId: semester.id, classId: cls.id } });
    await emit(tx, 'export.requested', { exportJobId: id });
    const row = await findJob(tx, id);
    if (!row) throw new Error('export job vanished');
    return view(row);
  });
}

/** Worker: gathers one rombel's semester (the worker's transaction runs under the requester's school, so RLS holds) into the report. */
export async function buildCharacterReport(tx: Tx, schoolId: string, job: ExportJobRow): Promise<CharacterReport> {
  if (!job.classId) throw new Error('character report job without a rombel');
  const [school, semester] = await Promise.all([schoolInfo(tx, schoolId), findSemester(tx, job.semesterId)]);
  if (!school || !semester) throw new Error('school or semester missing');
  const [cls] = await classesOfYear(tx, semester.academicYearId, job.classId);
  if (!cls) throw new Error('rombel missing');
  const classStudents = await studentsOfClass(tx, job.classId, semester.startsOn, semester.endsOn);
  const rows = await enrollmentDays(tx, semester.academicYearId, semester.startsOn, semester.endsOn, classStudents);
  const roster = characterRoster(rows.map((r) => ({ ...r, counts: { H: r.H, T: r.T, S: r.S, I: r.I, A: r.A } })), job.classId);
  const enrollmentIds = roster.flatMap((r) => r.enrollmentIds);
  const [points, habits, activities] = await Promise.all([
    pointTotalsInRange(tx, enrollmentIds, semester.startsOn, semester.endsOn),
    habitTallies(tx, enrollmentIds, semester.startsOn, semester.endsOn),
    activityTallies(tx, enrollmentIds, semester.startsOn, semester.endsOn),
  ]);
  return {
    school: { name: school.name, npsn: school.npsn },
    semester: { academicYear: semester.academicYear, number: semester.number, startsOn: semester.startsOn, endsOn: semester.endsOn },
    className: cls.name,
    homeroomName: cls.homeroomName,
    principalName: await principalName(tx),
    principalTitle: school.isMadrasah ? 'Kepala Madrasah' : 'Kepala Sekolah',
    signedOn: schoolDate(school.timezone),
    students: roster.map((student) => {
      const own = student.enrollmentIds;
      const pts = own.map((id) => points.get(id) ?? { achievementPoints: 0, violationPoints: 0 });
      return {
        name: student.name,
        nisn: student.nisn,
        counts: student.counts,
        presentRate: presentRateOf(student.counts),
        achievementPoints: pts.reduce((n, p) => n + p.achievementPoints, 0),
        // Violation points are stored negative; the report shows how many were taken off.
        violationPoints: Math.abs(pts.reduce((n, p) => n + p.violationPoints, 0)),
        habits: sumHabits(own.map((id) => habits.get(id) ?? [])),
        activities: mergeActivities(own.map((id) => activities.get(id) ?? [])),
      };
    }),
  };
}
