import { describe, expect, it } from 'vitest';
import { shouldDisable, WEBHOOK_AUTO_DISABLE_AFTER } from './webhook-health';

const run = (n: number, status: 'delivered' | 'failed') => Array.from({ length: n }, () => ({ status }));

describe('switching off an address that keeps failing (PLT-09)', () => {
  it('needs the whole run: fewer outcomes than the threshold never switch it off', () => {
    expect(shouldDisable(run(WEBHOOK_AUTO_DISABLE_AFTER - 1, 'failed'))).toBe(false);
    expect(shouldDisable([])).toBe(false);
  });

  it('switches off when the latest outcomes are all failures', () => {
    expect(shouldDisable(run(WEBHOOK_AUTO_DISABLE_AFTER, 'failed'))).toBe(true);
    expect(shouldDisable(run(WEBHOOK_AUTO_DISABLE_AFTER + 5, 'failed'))).toBe(true);
  });

  it('one answer inside the latest run keeps it on, while an old answer behind the run does not', () => {
    const recentAnswer = [...run(3, 'failed'), ...run(1, 'delivered'), ...run(20, 'failed')];
    expect(shouldDisable(recentAnswer)).toBe(false);
    const oldAnswer = [...run(WEBHOOK_AUTO_DISABLE_AFTER, 'failed'), ...run(1, 'delivered')];
    expect(shouldDisable(oldAnswer)).toBe(true);
  });

  it('takes the threshold as a parameter', () => {
    expect(shouldDisable(run(3, 'failed'), 3)).toBe(true);
    expect(shouldDisable([{ status: 'failed' }, { status: 'delivered' }, { status: 'failed' }], 3)).toBe(false);
  });
});
