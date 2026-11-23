import type { Logger } from 'pino';
import { issueDueInvoices } from '../application/invoices';

/**
 * bil.issue-invoices: 07.00 WIB on days 1-7. The 1st issues last month's invoices; the later days
 * only catch up schools a failed run missed (idempotent per school and month).
 */
export const ISSUE_INVOICES_QUEUE = 'bil.issue-invoices';
export const ISSUE_INVOICES_CRON = '0 7 1-7 * *';

export function issueInvoicesHandler(logger: Logger) {
  return async (): Promise<void> => {
    const { month, issued } = await issueDueInvoices(new Date(), logger);
    if (issued > 0) logger.info({ queue: ISSUE_INVOICES_QUEUE, month, issued }, 'invoices issued');
  };
}
