import type { ReportExporter } from '../../../domain/semester-recap';
import { recapPdf } from '../common/recap-pdf';
import { recapWorkbook } from '../common/recap-workbook';
import { ERAPOR_COLUMNS } from './columns';

/** e-Rapor (Kemendikdasmen): ketidakhadiran per semester as the import sheet and the signed archive PDF. */
export const eraporExporter: ReportExporter = {
  target: 'erapor',
  build: (recap, format) => (format === 'xlsx' ? recapWorkbook(recap, ERAPOR_COLUMNS) : recapPdf(recap, { principal: 'Kepala Sekolah' })),
};
