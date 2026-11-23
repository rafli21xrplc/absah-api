import { InvoiceDetail, InvoiceIdParam, InvoiceList } from '@absah/contracts';
import { Router } from 'express';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { invoiceDetail, invoicesFor } from '../application/invoices';

/** Absah's invoices to the school (BIL). Read only here; issued by the job. */
export function invoicesRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/billing/invoices', school, async (req, res) => {
    sendContract(res, InvoiceList, await invoicesFor(getActor(req)));
  });

  router.get('/billing/invoices/:invoiceId', school, async (req, res) => {
    const { invoiceId } = InvoiceIdParam.parse(req.params);
    sendContract(res, InvoiceDetail, await invoiceDetail(getActor(req), invoiceId));
  });

  return router;
}
