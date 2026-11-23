import { z } from 'zod';
import { PaymentMethod, PaymentStatus } from '../billing/enums';

/** TGH-03: a parent or the student pays an installment of their own bills; nobody else asks for a charge. */
export const STUDENT_BILL_PAYERS = ['orang_tua', 'siswa'] as const;

export const StudentPayment = z
  .object({
    id: z.uuid(),
    installmentId: z.uuid(),
    method: PaymentMethod,
    /** A pending charge past its expiry reads as expired. */
    status: PaymentStatus,
    amount: z.number().int(),
    vaBank: z.string().nullable(),
    vaNumber: z.string().nullable(),
    qrString: z.string().nullable(),
    expiresAt: z.string().nullable(),
    paidAt: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'StudentPayment' });
export type StudentPayment = z.infer<typeof StudentPayment>;

export const RequestStudentPaymentRequest = z.object({ method: PaymentMethod }).meta({ id: 'RequestStudentPaymentRequest' });
export type RequestStudentPaymentRequest = z.infer<typeof RequestStudentPaymentRequest>;

export const InstallmentIdParam = z.object({ installmentId: z.uuid() });
