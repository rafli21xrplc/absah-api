import { schema } from '@absah/db';
import { sql } from 'drizzle-orm';
import { withPlatform } from '../../../shared/db';
import { addDays } from '../../../shared/school-date';

/**
 * Ops (Absah team): mark or unmark days as not billed (long year-end break) for one school. Runs as
 * the owner role (withPlatform): the app role cannot touch billing_exempt (trigger). Marked days
 * become holidays; unmarking keeps the holiday.
 */
export async function setBillingExempt(schoolId: string, from: string, to: string, name: string, exempt: boolean): Promise<number> {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (days.length > 120) throw new Error('at most 120 days at once');
  return withPlatform(async (tx) => {
    if (!exempt) {
      const result = await tx.execute(sql`update calendar_days set billing_exempt = false where school_id = ${schoolId} and date between ${from} and ${to} and billing_exempt`);
      return result.rowCount ?? 0;
    }
    const rows = days.map((date) => ({ schoolId, date, kind: 'holiday' as const, name, billingExempt: true }));
    await tx
      .insert(schema.calendarDays)
      .values(rows)
      .onConflictDoUpdate({ target: [schema.calendarDays.schoolId, schema.calendarDays.date], set: { kind: 'holiday', billingExempt: true } });
    return rows.length;
  });
}
