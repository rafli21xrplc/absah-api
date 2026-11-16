import { z } from 'zod';

export const CARD_HOLDERS = ['student', 'parent'] as const;
export const CardHolder = z.enum(CARD_HOLDERS).meta({ id: 'CardHolder' });
export type CardHolder = z.infer<typeof CardHolder>;

export const SCAN_METHODS = ['qr', 'manual'] as const;
export const ScanMethod = z.enum(SCAN_METHODS).meta({ id: 'ScanMethod' });

/** accepted: first arrival of the day; duplicate: the student was already in; rejected: see reason. */
export const SCAN_RESULTS = ['accepted', 'duplicate', 'rejected'] as const;
export const ScanResult = z.enum(SCAN_RESULTS).meta({ id: 'ScanResult' });
export type ScanResult = z.infer<typeof ScanResult>;

export const SCAN_REJECT_REASONS = ['malformed', 'expired', 'no_key', 'bad_signature', 'unknown_card', 'wrong_device', 'not_enrolled'] as const;
export const ScanRejectReason = z.enum(SCAN_REJECT_REASONS).meta({ id: 'ScanRejectReason' });
export type ScanRejectReason = z.infer<typeof ScanRejectReason>;

export const ARRIVAL_OUTCOMES = ['on_time', 'late'] as const;
export const ArrivalOutcome = z.enum(ARRIVAL_OUTCOMES).meta({ id: 'ArrivalOutcome' });
export type ArrivalOutcome = z.infer<typeof ArrivalOutcome>;
