import { findPilotSchool, pilotPlan, writePilot, type PilotCounts } from '@absah/db/seed';
import { getDb } from '../../../shared/db';
import type { Auth } from '../infrastructure/auth';
import { createStaffUser, findUserByEmail } from '../infrastructure/users';

export type PilotSeedResult = ({ created: true } & PilotCounts) | { created: false; schoolId: string };

/**
 * Seeds the pilot school (prompt 4.4) once: staff accounts through Better Auth (all with `password`,
 * reused when the email exists), then the school data in one tenant transaction. A second run finds
 * the school by its NPSN and changes nothing.
 */
export async function seedPilot(auth: Auth, input: { password: string; hashKey: string; appRole: string }): Promise<PilotSeedResult> {
  const { db } = getDb();
  const existing = await findPilotSchool(db);
  if (existing) return { created: false, schoolId: existing };

  const plan = pilotPlan();
  const userIds: Record<string, string> = {};
  for (const s of plan.staff) {
    const found = await findUserByEmail(auth, s.email);
    if (found) {
      userIds[s.key] = found.id;
      continue;
    }
    userIds[s.key] = (await createStaffUser(auth, { name: s.name, email: s.email, password: input.password })).id;
  }
  return { created: true, ...(await writePilot(db, plan, userIds, input.hashKey, { appRole: input.appRole })) };
}
