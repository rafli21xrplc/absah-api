import { describe, expect, it } from 'vitest';
import { authorize } from './authorize';
import { ForbiddenError } from './errors';
import { anyRole, type Actor } from './policy';

const actor = (roles: Actor['roles']): Actor => ({ userId: 'u', schoolId: 's', roles });

describe('authorize', () => {
  it('passes when the actor has one of the roles', () => {
    expect(() => authorize(actor(['guru', 'wali_kelas']), anyRole('wali_kelas'))).not.toThrow();
  });

  it('throws ForbiddenError otherwise, including for no roles', () => {
    expect(() => authorize(actor(['guru']), anyRole('admin', 'operator'))).toThrow(ForbiddenError);
    expect(() => authorize(actor([]), anyRole('admin'))).toThrow(ForbiddenError);
  });
});
