import type { ExportJob } from '@absah/contracts';
import type { ExportJobRow } from '../infrastructure/export-repo';

/** The API shape of a job row; shared by the rekap exports and the character report. */
export function view(row: ExportJobRow): ExportJob {
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
