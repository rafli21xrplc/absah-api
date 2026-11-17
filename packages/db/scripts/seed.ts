// Minimal dev seed: one collection and one empty SMA school. Idempotent. For a full school with
// students, teachers and a timetable use `pnpm --filter @absah/server pilot:seed` (packages/db/seed).
import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { loadLocalEnv, requireEnv } from '../src/env';
import { collections, schools } from '../src/schema';

loadLocalEnv();
const handle = createDb(process.env.DATABASE_URL_DIRECT ?? requireEnv('DATABASE_URL'), { max: 1 });
try {
  const npsn = '99999901';
  const existing = await handle.db.select({ id: schools.id }).from(schools).where(eq(schools.npsn, npsn));
  if (existing.length > 0) {
    console.log('seed: school already present');
  } else {
    const [collection] = await handle.db.insert(collections).values({ name: 'Yayasan Absah Uji' }).returning();
    await handle.db.insert(schools).values({
      name: 'SMA Absah Dev',
      level: 'sma',
      npsn,
      collectionId: collection?.id,
    });
    console.log('seed: created SMA Absah Dev');
  }
} finally {
  await handle.close();
}
