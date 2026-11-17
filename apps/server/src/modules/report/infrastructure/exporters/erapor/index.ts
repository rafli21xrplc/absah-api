import type { ReportExporter } from '../../../domain/semester-recap';
import { eraporPdf } from './pdf';
import { eraporWorkbook } from './xlsx';

/** e-Rapor (Kemendikdasmen): ketidakhadiran per semester as the import sheet and the signed archive PDF. */
export const eraporExporter: ReportExporter = {
  target: 'erapor',
  build: (recap, format) => (format === 'xlsx' ? eraporWorkbook(recap) : eraporPdf(recap)),
};
