import {
  PKL_EARLY_CHECKIN_MINUTES,
  PKL_MAX_CLOCK_SKEW_SECONDS,
  type PklCheckinKind,
  type PklConfirmStatus,
  type PklReviewReason,
} from '@absah/contracts';

/** Pure PKL check-in rules (PKL-02): geofence, working hours, device clock. */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius (IUGG), metres. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 4 decimals = about 11 m: enough to check a check-in, not a precise trace (architecture "Lokasi PKL"). */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** "08:00" or "08:00:00" (Postgres time) -> minutes since midnight. */
export function clockMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface WorkHours {
  startsAt: string;
  endsAt: string;
}

/** A check-out may come this long after closing time (overtime) and still be within hours. */
export const PKL_LATE_CHECKOUT_MINUTES = 180;

/**
 * Whether a check-in/out at `minutes` (DUDI local clock) fits the day's hours. Check-in: from
 * PKL_EARLY_CHECKIN_MINUTES before opening until closing. Check-out: from opening until
 * PKL_LATE_CHECKOUT_MINUTES after closing. No hours (closed that day) never fits.
 */
export function withinWorkHours(kind: PklCheckinKind, hours: WorkHours | null, minutes: number): boolean {
  if (!hours) return false;
  const start = clockMinutes(hours.startsAt);
  const end = clockMinutes(hours.endsAt);
  return kind === 'in'
    ? minutes >= start - PKL_EARLY_CHECKIN_MINUTES && minutes < end
    : minutes >= start && minutes <= end + PKL_LATE_CHECKOUT_MINUTES;
}

/** Seconds between the phone's clock and the server's (absolute). */
export function clockSkewSeconds(deviceTime: Date, serverTime: Date): number {
  return Math.abs(deviceTime.getTime() - serverTime.getTime()) / 1000;
}

export interface CheckinInput {
  kind: PklCheckinKind;
  point: GeoPoint;
  partner: GeoPoint & { radiusM: number };
  /** The DUDI's hours on this weekday, null when closed. */
  hours: WorkHours | null;
  /** Minutes since midnight on the school clock at server time. */
  localMinutes: number;
  deviceTime: Date;
  serverTime: Date;
  hasIndustryMentor: boolean;
}

export interface CheckinClassification {
  distanceM: number;
  reasons: PklReviewReason[];
  /** Check-in after opening time: a confirmation records T. */
  late: boolean;
  /** null for check-outs (only check-ins are confirmed). */
  confirmStatus: Extract<PklConfirmStatus, 'pending' | 'needs_review'> | null;
}

/**
 * Classifies one check-in/out. Any reason sends a check-in to the school supervisor's review queue
 * (needs_review) instead of the industry supervisor (pending). The distance is measured from the
 * reported point, before rounding; the GPS accuracy is stored but does not widen the radius.
 */
export function classifyCheckin(input: CheckinInput): CheckinClassification {
  const distanceM = Math.round(haversineMeters(input.point, input.partner));
  const reasons: PklReviewReason[] = [];
  if (distanceM > input.partner.radiusM) reasons.push('outside_radius');
  if (!withinWorkHours(input.kind, input.hours, input.localMinutes)) reasons.push('outside_hours');
  if (clockSkewSeconds(input.deviceTime, input.serverTime) > PKL_MAX_CLOCK_SKEW_SECONDS) reasons.push('clock_skew');
  if (input.kind === 'in' && !input.hasIndustryMentor) reasons.push('no_industry_mentor');

  const late = input.kind === 'in' && input.hours !== null && input.localMinutes > clockMinutes(input.hours.startsAt);
  const confirmStatus = input.kind === 'out' ? null : reasons.length > 0 ? 'needs_review' : 'pending';
  return { distanceM, reasons, late, confirmStatus };
}

/** The attendance status a confirmed check-in records. */
export const confirmedStatus = (late: boolean) => (late ? 'T' : 'H');

/** pkl.missing-checkin reminds at 10.00, or an hour after opening when the DUDI opens later. */
export const PKL_MISSING_CHECKIN_AT = 10 * 60;

export function missingCheckinDue(localMinutes: number, startsAt: string): boolean {
  return localMinutes >= Math.max(PKL_MISSING_CHECKIN_AT, clockMinutes(startsAt) + 60);
}
