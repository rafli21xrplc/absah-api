import { schema, type Tx } from '@absah/db';
import { sql } from 'drizzle-orm';
import type { ClassBills, ClassInstallments } from '../domain/recap';

const optional = (column: string, id: string | undefined) => (id ? sql`and ${sql.raw(column)} = ${id}::uuid` : sql``);

/** Bills that are not void, per rombel. */
export async function billsPerClass(tx: Tx, feeTypeId: string | undefined): Promise<ClassBills[]> {
  const res = await tx.execute<{ class_id: string; class_name: string; n: string; billed: string }>(sql`
    select c.id as class_id, c.name as class_name, count(*) as n, coalesce(sum(b.total), 0) as billed
    from ${schema.studentBills} b
    join ${schema.enrollments} e on e.id = b.enrollment_id
    join ${schema.classes} c on c.id = e.class_id
    where b.status <> 'void' ${optional('b.fee_type_id', feeTypeId)}
    group by c.id, c.name`);
  return res.rows.map((r) => ({ classId: r.class_id, className: r.class_name, count: Number(r.n), billed: Number(r.billed) }));
}

/** Rupiah of installments paid, and of unpaid ones past due on open bills, per rombel. */
export async function installmentsPerClass(tx: Tx, today: string, feeTypeId: string | undefined): Promise<ClassInstallments[]> {
  const res = await tx.execute<{ class_id: string; paid: string; overdue: string }>(sql`
    select c.id as class_id,
      coalesce(sum(i.amount) filter (where i.paid_at is not null), 0) as paid,
      coalesce(sum(i.amount) filter (where i.paid_at is null and b.status = 'open' and i.due_on < ${today}::date), 0) as overdue
    from ${schema.billInstallments} i
    join ${schema.studentBills} b on b.id = i.bill_id
    join ${schema.enrollments} e on e.id = b.enrollment_id
    join ${schema.classes} c on c.id = e.class_id
    where b.status <> 'void' ${optional('b.fee_type_id', feeTypeId)}
    group by c.id`);
  return res.rows.map((r) => ({ classId: r.class_id, paid: Number(r.paid), overdue: Number(r.overdue) }));
}

/** Payments the gateway marked paid within [from, to) school dates, per day and method; flagged = counted for nothing. */
export async function receivedPerDay(tx: Tx, from: string, to: string, timezone: string, feeTypeId: string | undefined) {
  const res = await tx.execute<{ day: string; method: 'va' | 'qris'; n: string; amount: string; flagged: string }>(sql`
    select to_char((p.paid_at at time zone ${timezone})::date, 'YYYY-MM-DD') as day, p.method, count(*) as n, sum(p.amount) as amount,
      count(*) filter (where p.last_error in ('paid_twice', 'bill_void')) as flagged
    from ${schema.studentPayments} p
    join ${schema.billInstallments} i on i.id = p.installment_id
    join ${schema.studentBills} b on b.id = i.bill_id
    where p.status = 'paid' and (p.paid_at at time zone ${timezone})::date >= ${from}::date and (p.paid_at at time zone ${timezone})::date < ${to}::date ${optional('b.fee_type_id', feeTypeId)}
    group by 1, 2
    order by 1`);
  return res.rows.map((r) => ({ day: r.day, method: r.method, count: Number(r.n), amount: Number(r.amount), flagged: Number(r.flagged) }));
}
