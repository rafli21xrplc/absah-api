export interface ClassBills {
  classId: string;
  className: string;
  count: number;
  billed: number;
}
export interface ClassInstallments {
  classId: string;
  paid: number;
  overdue: number;
}
export interface ClassRecap extends ClassBills {
  paid: number;
  outstanding: number;
  overdue: number;
}

/** [from, to) in dates: the month's first day and the next month's first day. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/** What is owed per rombel: billed minus paid, the most owed first, then by name. */
export function mergeRecap(bills: ClassBills[], installments: ClassInstallments[]): { classes: ClassRecap[]; totals: { count: number; billed: number; paid: number; outstanding: number; overdue: number } } {
  const byClass = new Map(installments.map((i) => [i.classId, i]));
  const classes = bills
    .map((b) => {
      const i = byClass.get(b.classId);
      const paid = i?.paid ?? 0;
      return { ...b, paid, outstanding: b.billed - paid, overdue: i?.overdue ?? 0 };
    })
    .sort((a, b) => b.outstanding - a.outstanding || a.className.localeCompare(b.className, 'id') || a.classId.localeCompare(b.classId));
  const sum = (pick: (c: ClassRecap) => number) => classes.reduce((n, c) => n + pick(c), 0);
  return { classes, totals: { count: sum((c) => c.count), billed: sum((c) => c.billed), paid: sum((c) => c.paid), outstanding: sum((c) => c.outstanding), overdue: sum((c) => c.overdue) } };
}
