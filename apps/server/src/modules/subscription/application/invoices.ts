import type { Invoice, InvoiceDetail, InvoiceList } from '@absah/contracts';
import type { Logger } from 'pino';
import { authorize } from '../../../shared/authorize';
import { withPlatform, withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { addDays, schoolDate } from '../../../shared/school-date';
import { computeInvoice, monthRange, previousMonth } from '../domain/invoice';
import { canReadBilling } from '../domain/policies';
import { billingSchools, enrollmentsInMonth, exemptDaysInMonth, findInvoice, insertInvoice, invoiceLines, listInvoices, type InvoiceRow } from '../infrastructure/invoice-repo';

/** Billing runs on Absah's clock (WIB): invoices are issued on the 1st at 07.00 Jakarta time. */
export const BILLING_TIMEZONE = 'Asia/Jakarta';
/** Days after issue until an invoice is due. */
export const PAYMENT_TERM_DAYS = 14;

const tenant = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

/**
 * One school's invoice for `month` (YYYY-MM). Idempotent per (school, month): a month already issued
 * is left as it is. A month without any billed student-day issues nothing.
 */
export function issueInvoiceForSchool(schoolId: string, month: string, now: Date): Promise<{ invoiceId: string; total: number } | null> {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [first, last] = monthRange(month);
    const computed = computeInvoice(await enrollmentsInMonth(tx, first, last), await exemptDaysInMonth(tx, first, last), month);
    if (computed.lines.length === 0) return null;
    const dueOn = addDays(schoolDate(BILLING_TIMEZONE, now), PAYMENT_TERM_DAYS);
    const invoiceId = await insertInvoice(tx, schoolId, computed, dueOn, now);
    return invoiceId ? { invoiceId, total: computed.total } : null;
  });
}

/** Job bil.issue-invoices: the previous month (WIB) for every school. */
export async function issueDueInvoices(now = new Date(), logger?: Logger): Promise<{ month: string; issued: number }> {
  const month = previousMonth(schoolDate(BILLING_TIMEZONE, now).slice(0, 7));
  // withPlatform: the scheduled job lists schools across tenants; each invoice is built in withTenant.
  const schools = await withPlatform(billingSchools);
  let issued = 0;
  for (const school of schools) {
    try {
      if (await issueInvoiceForSchool(school.id, month, now)) issued += 1;
    } catch (err) {
      // One broken school must not stop the others; the next run (days 1-7) tries again.
      logger?.error({ err, schoolId: school.id, month }, 'invoice issue failed for school');
    }
  }
  return { month, issued };
}

const toInvoice = (r: InvoiceRow): Invoice => ({ ...r, issuedAt: r.issuedAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null });

export function invoicesFor(actor: Actor): Promise<InvoiceList> {
  authorize(actor, canReadBilling);
  return withTenant(tenant(actor), async (tx) => ({ items: (await listInvoices(tx)).map(toInvoice) }));
}

export function invoiceDetail(actor: Actor, invoiceId: string): Promise<InvoiceDetail> {
  authorize(actor, canReadBilling);
  return withTenant(tenant(actor), async (tx) => {
    const row = await findInvoice(tx, invoiceId);
    if (!row) throw new NotFoundError('Tagihan tidak ditemukan.');
    return { ...toInvoice(row), lines: await invoiceLines(tx, invoiceId) };
  });
}
