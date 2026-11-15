import { describe, expect, it } from 'vitest';
// Relative import on purpose: contracts has no package dependency on capabilities (see context.ts).
import { LEVELS } from '../../../capabilities/src/index';
import { MeContextResponse, SCHOOL_LEVELS } from '../index';

describe('context contracts', () => {
  it('school levels stay in sync with @absah/capabilities', () => {
    expect(SCHOOL_LEVELS).toEqual(LEVELS);
  });

  it('accepts a context without an active school', () => {
    const ok = MeContextResponse.safeParse({
      user: { id: '0190a2b4-0000-7000-8000-000000000001', name: 'Guru', email: null, phoneNumber: null, twoFactorEnabled: false },
      schools: [],
      active: null,
    });
    expect(ok.success).toBe(true);
  });
});
