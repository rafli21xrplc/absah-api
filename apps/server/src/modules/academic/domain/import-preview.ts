import type { ImportCounts, ImportPreviewItem } from '@absah/contracts';
import type { ImportIssue } from './student-import';
import type { ImportPlan } from './student-matching';

/** Preview lines and counts staff see before committing. NIK never appears unmasked. */
export function describePlan(plan: ImportPlan, issues: ImportIssue[]): { counts: ImportCounts; items: ImportPreviewItem[] } {
  const rowName = new Map([...plan.created, ...plan.changed.map((m) => m.incoming), ...plan.unchanged.map((m) => m.incoming)].map((r) => [r.row, r]));
  const items: ImportPreviewItem[] = [
    ...plan.created.map((r) => ({
      kind: 'created' as const,
      row: r.row,
      name: r.name,
      nisn: r.nisn,
      className: r.className,
      matchedBy: null,
      changes: [],
      message: null,
    })),
    ...plan.changed.map((m) => ({
      kind: 'changed' as const,
      row: m.incoming.row,
      name: m.incoming.name,
      nisn: m.incoming.nisn,
      className: m.incoming.className,
      matchedBy: m.matchedBy,
      changes: m.changes,
      message: null,
    })),
    ...plan.missing.map((s) => ({
      kind: 'missing' as const,
      row: null,
      name: s.name,
      nisn: s.nisn,
      className: s.enrollment?.className ?? null,
      matchedBy: null,
      changes: [],
      message: 'Tidak ada di berkas: ditandai calon keluar, data tidak dihapus.',
    })),
    ...plan.rejected.map((r) => ({
      kind: 'rejected' as const,
      row: r.row,
      name: rowName.get(r.row)?.name ?? '',
      nisn: rowName.get(r.row)?.nisn ?? null,
      className: rowName.get(r.row)?.className ?? null,
      matchedBy: null,
      changes: [],
      message: r.message,
    })),
  ];
  return {
    counts: {
      created: plan.created.length,
      changed: plan.changed.length,
      unchanged: plan.unchanged.length,
      missing: plan.missing.length,
      rejected: plan.rejected.length + issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    },
    items,
  };
}

/** What a commit would do, independent of order: equal when the plan is the same. */
export function planSignature(plan: ImportPlan): unknown {
  return {
    created: plan.created.map((r) => r.row).sort((a, b) => a - b),
    changed: plan.changed.map((m) => [m.studentId, m.incoming.row, m.changes]).sort(),
    unchanged: plan.unchanged.map((m) => m.studentId).sort(),
    missing: plan.missing.map((s) => s.id).sort(),
    rejected: plan.rejected.map((r) => r.row).sort((a, b) => a - b),
  };
}

/** Tahun ajaran runs mid-July to June. Default when the school has no active year yet. */
export function defaultAcademicYear(today: string): { name: string; startsOn: string; endsOn: string } {
  const [y = 0, m = 1] = today.split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return { name: `${start}/${start + 1}`, startsOn: `${start}-07-01`, endsOn: `${start + 1}-06-30` };
}
