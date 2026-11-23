import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { loadCapabilities, type SchoolProfile } from '../../../shared/capability';
import { withPlatform, withTenant } from '../../../shared/db';
import { emit } from '../../../shared/outbox';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { REMIND_AT_MINUTES, remindWindow } from '../domain/reminders';
import { dueForReminder, markReminded } from '../infrastructure/reminder-repo';

type JobSchool = SchoolProfile & { id: string };
const BATCH = 500;

/**
 * Job tgh.remind-due (every 5 minutes, each school's clock): from 08.00 school time, every unpaid installment due in the
 * next days gets one reminder event (the parents' WhatsApp is notify's consumer). The marker is the installment's
 * reminded_at, written in the same transaction as the event, so a repeated or late run reminds nobody twice and a
 * crashed one leaves nothing half done. Schools with student.billing off are skipped.
 */
export async function remindDueInstallments(now = new Date(), logger?: Logger): Promise<number> {
  const schools = await withPlatform(async (tx) => {
    const res = await tx.execute<{ id: string; timezone: string; level: JobSchool['level']; is_madrasah: boolean }>(sql`select id, timezone, level, is_madrasah from schools order by id`);
    return res.rows.map((s): JobSchool => ({ id: s.id, timezone: s.timezone, level: s.level, isMadrasah: s.is_madrasah }));
  });
  let reminded = 0;
  for (const school of schools) {
    try {
      if (schoolMinutes(school.timezone, now) < REMIND_AT_MINUTES) continue;
      const caps = await loadCapabilities({ schoolId: school.id, userId: null }, school, logger);
      if (!caps['student.billing']) continue;
      const { from, to } = remindWindow(schoolDate(school.timezone, now));
      reminded += await withTenant({ schoolId: school.id, userId: null }, async (tx) => {
        const due = await dueForReminder(tx, from, to, BATCH);
        for (const row of due) {
          await markReminded(tx, row.id, now);
          await emit(tx, 'student_bill.reminder_due', { installmentId: row.id });
        }
        return due.length;
      });
    } catch (err) {
      logger?.error({ err, schoolId: school.id }, 'bill reminders failed for school');
    }
  }
  return reminded;
}
