import type { ReportExporter } from '../../../domain/semester-recap';
import { recapPdf } from '../common/recap-pdf';
import { recapWorkbook } from '../common/recap-workbook';
import { RDM_COLUMNS } from './columns';

/** RDM (Kemenag, RKP-07): the same semester rekap as e-Rapor, in the madrasah's sheet and wording. */
export const rdmExporter: ReportExporter = {
  target: 'rdm',
  build: (recap, format) => (format === 'xlsx' ? recapWorkbook(recap, RDM_COLUMNS) : recapPdf(recap, { principal: 'Kepala Madrasah' })),
};
