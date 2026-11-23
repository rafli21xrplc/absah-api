import type { CollectionDashboardList, Role } from '@absah/contracts';
import { loadCapabilities } from '../../../shared/capability';
import type { Actor } from '../../../shared/policy';
import { combineSchools, schoolSummary } from '../domain/dashboard';
import { type CollectionSchool, collectionSchools } from '../infrastructure/collection-repo';
import { principalDashboard } from './dashboard';

/** Roles that may read a school's principal dashboard; an admin counts only with two-step login (the rest of the API requires it). */
const LEADER_ROLES: Role[] = ['kepsek', 'wakasek', 'admin'];
const CONCURRENCY = 4;

const leadershipRoles = (twoFactorEnabled: boolean, roles: readonly Role[]) => roles.filter((r) => r !== 'admin' || twoFactorEnabled);

/**
 * GET /dashboard/collections (RKP-06): for every collection with a school where the caller leads, each such school's principal
 * dashboard is computed inside its own tenant (withTenant, so RLS and the school's capabilities apply exactly as on its own
 * dashboard) and the results are then put together. No query ever reads across schools.
 */
export async function collectionDashboards(user: { id: string; twoFactorEnabled: boolean }, now = new Date()): Promise<CollectionDashboardList> {
  const seats = (await collectionSchools(user.id, LEADER_ROLES)).flatMap((s) => {
    const roles = leadershipRoles(user.twoFactorEnabled, s.roles);
    return roles.length > 0 ? [{ ...s, roles }] : [];
  });
  const results = new Map<string, Awaited<ReturnType<typeof ofSchool>>>();
  for (let i = 0; i < seats.length; i += CONCURRENCY) {
    await Promise.all(seats.slice(i, i + CONCURRENCY).map(async (seat) => results.set(seat.schoolId, await ofSchool(user.id, seat, now))));
  }
  const collections = new Map<string, { id: string; name: string; seats: CollectionSchool[] }>();
  for (const seat of seats) {
    const entry = collections.get(seat.collectionId) ?? { id: seat.collectionId, name: seat.collectionName, seats: [] };
    entry.seats.push(seat);
    collections.set(seat.collectionId, entry);
  }
  return {
    items: [...collections.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'id'))
      .map((c) => {
        const schools = c.seats.sort((a, b) => a.schoolName.localeCompare(b.schoolName, 'id')).map((seat) => schoolSummary(seat.schoolId, seat.schoolName, requireResult(results, seat.schoolId).dashboard));
        const trends = c.seats.map((seat) => requireResult(results, seat.schoolId).dashboard.attendance.trend);
        return { id: c.id, name: c.name, schools, ...combineSchools(schools, trends) };
      }),
  };
}

async function ofSchool(userId: string, seat: CollectionSchool, now: Date) {
  const actor: Actor = { userId, schoolId: seat.schoolId, roles: seat.roles };
  const caps = await loadCapabilities({ schoolId: seat.schoolId, userId }, { level: seat.level, isMadrasah: seat.isMadrasah, timezone: seat.timezone });
  const dashboard = await principalDashboard(actor, { earlyWarning: caps['student.early_warning'] === true, mbg: caps['mbg.enabled'] === true }, now);
  return { dashboard };
}

function requireResult<T>(results: Map<string, T>, schoolId: string): T {
  const found = results.get(schoolId);
  if (!found) throw new Error(`no dashboard computed for school ${schoolId}`);
  return found;
}
