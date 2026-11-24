import { WEBHOOK_AUTO_DISABLE_AFTER } from '@absah/contracts';

/**
 * When an address that keeps failing is switched off by itself (PLT-09). Pure: the caller hands over the latest finished
 * outcomes of the address, newest first, already limited to what counts (no test pings, nothing that failed only because the
 * address was already off, nothing from before the admin last changed it). A retry run of one call is one failure, not six.
 */
export { WEBHOOK_AUTO_DISABLE_AFTER };

export interface Outcome {
  status: 'delivered' | 'failed';
}

/** True when the latest `threshold` outcomes all failed. One answer inside that run resets the count. */
export function shouldDisable(latestFirst: readonly Outcome[], threshold: number = WEBHOOK_AUTO_DISABLE_AFTER): boolean {
  return latestFirst.length >= threshold && latestFirst.slice(0, threshold).every((o) => o.status === 'failed');
}
