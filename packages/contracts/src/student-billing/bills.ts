import { z } from 'zod';
import { MAX_INSTALLMENTS, BillStatus } from './constants';
import { StudentPayment } from './payments';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD.');

export const BillInstallmentInput = z.object({ amount: z.number().int().min(1).max(100_000_000), dueOn: IsoDate });
export type BillInstallmentInput = z.infer<typeof BillInstallmentInput>;

/** Who is billed: every active student of one rombel, or of one grade (angkatan) across its rombel. */
export const BillTarget = z
  .discriminatedUnion('kind', [z.object({ kind: z.literal('class'), classId: z.uuid() }), z.object({ kind: z.literal('grade'), grade: z.number().int().min(1).max(13) })])
  .meta({ id: 'BillTarget' });
export type BillTarget = z.infer<typeof BillTarget>;

/**
 * Mass issue (TGH-01): one bill per student for a fee type and a period. Repeating it with the same period creates
 * nothing twice. A plan of installments (cicilan, 2..12 parts adding up to the amount) replaces dueOn; the bill is due
 * on the last of them.
 */
export const IssueBillsRequest = z
  .object({
    feeTypeId: z.uuid(),
    /** What the bill is for ("2026-11", "Semester 1"); with the student and the fee type it is the bill's identity. */
    period: z.string().trim().min(1, 'Tulis periodenya.').max(40),
    title: z.string().trim().min(1).max(120).optional(),
    /** Whole rupiah; defaults to the fee type's. */
    amount: z.number().int().min(1).max(100_000_000).optional(),
    dueOn: IsoDate.optional(),
    installments: z.array(BillInstallmentInput).min(2, 'Cicilan minimal 2 bagian.').max(MAX_INSTALLMENTS).optional(),
    target: BillTarget,
  })
  .refine((v) => (v.dueOn === undefined) !== (v.installments === undefined), { message: 'Isi tanggal jatuh tempo, atau rencana cicilan, salah satunya.', path: ['dueOn'] })
  .meta({ id: 'IssueBillsRequest' });
export type IssueBillsRequest = z.infer<typeof IssueBillsRequest>;

export const IssueBillsResult = z
  .object({
    created: z.number().int(),
    /** Students who already had this bill (same fee type and period). */
    skipped: z.number().int(),
    /** Rupiah newly billed. */
    billed: z.number().int(),
  })
  .meta({ id: 'IssueBillsResult' });
export type IssueBillsResult = z.infer<typeof IssueBillsResult>;

export const BillInstallment = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    amount: z.number().int(),
    dueOn: z.string(),
    paidAt: z.string().nullable(),
    /** The latest attempt to pay it (a VA or QRIS being paid, paid, or expired/failed so a new one can be asked), if any. */
    payment: StudentPayment.nullable(),
  })
  .meta({ id: 'BillInstallment' });
export type BillInstallment = z.infer<typeof BillInstallment>;

export const StudentBill = z
  .object({
    id: z.uuid(),
    enrollmentId: z.uuid(),
    student: z.object({ name: z.string(), className: z.string() }),
    feeType: z.object({ id: z.uuid(), name: z.string() }),
    period: z.string(),
    title: z.string(),
    total: z.number().int(),
    /** Rupiah of the installments already paid. */
    paid: z.number().int(),
    dueOn: z.string(),
    status: BillStatus,
    /** Open and past its due date with something still unpaid. */
    overdue: z.boolean(),
    paidAt: z.string().nullable(),
    voidedAt: z.string().nullable(),
    voidReason: z.string().nullable(),
    installments: z.array(BillInstallment),
  })
  .meta({ id: 'StudentBill' });
export type StudentBill = z.infer<typeof StudentBill>;

export const BillsQuery = z.object({
  status: BillStatus.optional(),
  feeTypeId: z.uuid().optional(),
  classId: z.uuid().optional(),
  enrollmentId: z.uuid().optional(),
  period: z.string().trim().min(1).max(40).optional(),
  overdue: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type BillsQuery = z.infer<typeof BillsQuery>;

export const StudentBillList = z.object({ items: z.array(StudentBill), total: z.number().int() }).meta({ id: 'StudentBillList' });
export type StudentBillList = z.infer<typeof StudentBillList>;

export const BillIdParam = z.object({ billId: z.uuid() });

export const VoidBillRequest = z.object({ reason: z.string().trim().min(1, 'Tulis alasan membatalkan.').max(200) }).meta({ id: 'VoidBillRequest' });
export type VoidBillRequest = z.infer<typeof VoidBillRequest>;

/** What a parent (or the student) owes: the bills of their own children, paid ones for the history, void ones left out. */
export const MyBillsList = z.object({ items: z.array(StudentBill) }).meta({ id: 'MyBillsList' });
export type MyBillsList = z.infer<typeof MyBillsList>;
