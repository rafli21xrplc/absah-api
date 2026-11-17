import type { ExportTarget } from '@absah/contracts';
import type { ReportExporter } from '../../domain/semester-recap';
import { eraporExporter } from './erapor';

/** Exporters by target; RDM (prompt 5.5) adds the second implementation. */
const EXPORTERS: Partial<Record<ExportTarget, ReportExporter>> = { erapor: eraporExporter };

export function exporterFor(target: ExportTarget): ReportExporter | null {
  return EXPORTERS[target] ?? null;
}
