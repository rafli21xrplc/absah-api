import type { ExportTarget } from '@absah/contracts';
import type { ReportExporter } from '../../domain/semester-recap';
import { eraporExporter } from './erapor';
import { rdmExporter } from './rdm';

/** Exporters by target (report.target). RDM ships behind the release flag rdm-export-beta. */
const EXPORTERS: Partial<Record<ExportTarget, ReportExporter>> = { erapor: eraporExporter, rdm: rdmExporter };

export function exporterFor(target: ExportTarget): ReportExporter | null {
  return EXPORTERS[target] ?? null;
}
