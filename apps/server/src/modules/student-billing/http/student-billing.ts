import { BillIdParam, BillsQuery, CreateFeeTypeRequest, FeeType, InstallmentIdParam, MyBillsList, RequestStudentPaymentRequest, StudentPayment, FeeTypeIdParam, FeeTypeList, FeeTypesQuery, IssueBillsRequest, IssueBillsResult, StudentBill, StudentBillList, UpdateFeeTypeRequest, VoidBillRequest } from '@absah/contracts';
import { Router, type Request } from 'express';
import type { PaymentProvider } from '../../../shared/payments';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { schoolDate } from '../../../shared/school-date';
import { resolveContext, type Auth } from '../../platform';
import { issueBills, listStudentBills, voidBill } from '../application/bills';
import { createFeeType, listFeeTypesFor, updateFeeTypeFor } from '../application/fees';
import { myBills, requestStudentPayment } from '../application/payments';

/** Today on the selected school's clock (default Asia/Jakarta). */
const today = (req: Request): string => {
  const ctx = getCtx(req);
  return schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
};

/** Tagihan siswa (TGH), behind student.billing. */
export function studentBillingRouter(auth: Auth, provider: PaymentProvider | null = null): Router {
  const router = Router();
  const billing = [resolveContext(auth, { school: 'required' }), requireCap('student.billing')];

  router.get('/student-billing/fee-types', ...billing, async (req, res) => {
    sendContract(res, FeeTypeList, await listFeeTypesFor(getActor(req), FeeTypesQuery.parse(req.query).includeInactive));
  });
  router.post('/student-billing/fee-types', ...billing, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, FeeType, await createFeeType(actor, auditContext(req, actor), CreateFeeTypeRequest.parse(req.body)), 201);
  });
  router.patch('/student-billing/fee-types/:feeTypeId', ...billing, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, FeeType, await updateFeeTypeFor(actor, auditContext(req, actor), FeeTypeIdParam.parse(req.params).feeTypeId, UpdateFeeTypeRequest.parse(req.body)));
  });
  router.post('/student-billing/issue', ...billing, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, IssueBillsResult, await issueBills(actor, auditContext(req, actor), IssueBillsRequest.parse(req.body)), 201);
  });
  router.get('/student-billing/bills', ...billing, async (req, res) => {
    sendContract(res, StudentBillList, await listStudentBills(getActor(req), BillsQuery.parse(req.query), today(req)));
  });
  router.post('/student-billing/bills/:billId/void', ...billing, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, StudentBill, await voidBill(actor, auditContext(req, actor), BillIdParam.parse(req.params).billId, VoidBillRequest.parse(req.body), today(req)));
  });

  // A parent or the student: their own bills, and a charge (VA / QRIS) for one installment.
  router.get('/student-billing/mine', ...billing, async (req, res) => {
    sendContract(res, MyBillsList, await myBills(getActor(req), today(req)));
  });
  router.post('/student-billing/installments/:installmentId/payments', ...billing, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, StudentPayment, await requestStudentPayment(actor, auditContext(req, actor), provider, InstallmentIdParam.parse(req.params).installmentId, RequestStudentPaymentRequest.parse(req.body)), 202);
  });

  return router;
}
