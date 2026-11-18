import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { setReleaseFlag } from '../src/modules/platform';
import { readReleaseFlags } from '../src/shared/capability';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

describe('release:flag (ops)', () => {
  it('opens a release flag for one school and closes it again', async () => {
    const school = await t.school('sma', 'MA Flag');
    const other = await t.school('sma', 'MA Lain');
    const flags = (id: string) => withTenant({ schoolId: id, userId: null }, readReleaseFlags);
    try {
      await setReleaseFlag('rdm-export-beta', school, true, 'test');
      expect((await flags(school))['rdm-export-beta']).toBe(true);
      expect((await flags(other))['rdm-export-beta']).toBe(false);
      await setReleaseFlag('rdm-export-beta', school, false, 'test');
      expect((await flags(school))['rdm-export-beta']).toBe(false);
      await expect(setReleaseFlag('no-such-flag', school, true, 'test')).rejects.toThrow('unknown release flag');
    } finally {
      await getDb().db.delete(schema.platformFlags).where(eq(schema.platformFlags.schoolId, school));
    }
  });
});
