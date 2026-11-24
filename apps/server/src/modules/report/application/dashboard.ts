import { DASHBOARD_TREND_DAYS, type AttendanceCounts, type PrincipalDashboard } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { authorize } from '../../../shared/authorize';
import type { Actor } from '../../../shared/policy';
import { addDays, schoolDate } from '../../../shared/school-date';
import { listEarlyWarnings } from '../../student-affairs';
import { atRiskStudents, attendanceTrend } from '../domain/dashboard';
import { canReadPrincipalDashboard } from '../domain/policies';
import { recapTotals, summarizeCompliance } from '../domain/recap';
import { mbgDaily } from './mbg';
import { schoolTimezone } from '../infrastructure/mbg-repo';
import { complianceRows, dailyCounts } from '../infrastructure/recap-repo';

const WARNING_DAYS = 7;

const countsOf = (row: AttendanceCounts): AttendanceCounts => ({ H: row.H, T: row.T, S: row.S, I: row.I, A: row.A });

/**
 * GET /dashboard/principal (RKP-05): attendance today and over the last school dates, how many of today's sessions are filled,
 * the students the early warnings of the last week name, and today's MBG count. Each part reads the same rows as its own report;
 * `features` says which optional parts the school has (the router passes the school's capabilities).
 */
export async function principalDashboard(actor: Actor, features: { earlyWarning: boolean; mbg: boolean }, now = new Date()): Promise<PrincipalDashboard> {
  authorize(actor, canReadPrincipalDashboard);
  const base = await withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const today = schoolDate(await schoolTimezone(tx, actor.schoolId), now);
    const rows = await dailyCounts(tx, addDays(today, -(DASHBOARD_TREND_DAYS - 1)), today);
    const sessions = summarizeCompliance(await complianceRows(tx, today, today)).totals;
    return { today, rows, sessions };
  });
  const byDate = rows(base.rows);
  const todayRow = byDate.find((r) => r.date === base.today);
  const [atRisk, mbg] = await Promise.all([
    features.earlyWarning ? listEarlyWarnings(actor, base.today, { days: WARNING_DAYS }).then((l) => atRiskStudents(l.items)) : null,
    features.mbg ? mbgDaily(actor, base.today, now) : null,
  ]);
  const totals = recapTotals(todayRow?.counts ?? countsOf({ H: 0, T: 0, S: 0, I: 0, A: 0 }));
  const { sessions } = base;
  return {
    schoolDate: base.today,
    attendance: { today: { counts: totals.counts, days: totals.days, presentRate: totals.presentRate }, trend: attendanceTrend(byDate) },
    sessions: { total: sessions.sessions, filled: sessions.filled, missed: sessions.missed, open: sessions.open, fillRate: sessions.fillRate },
    atRisk,
    mbg: mbg ? { status: mbg.status, enrolled: mbg.total.enrolled, present: mbg.total.present, unrecorded: mbg.total.unrecorded } : null,
  };
}

function rows(raw: Awaited<ReturnType<typeof dailyCounts>>) {
  return raw.map((r) => ({ date: r.date, counts: countsOf(r) }));
}
