import { schoolDayKey, verifyCardToken, type ScanRejectReason } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { schoolSecret } from '../infrastructure/gate-secret-repo';
import { cardForScan } from '../infrastructure/scan-repo';

export type CardCheck = { ok: true; studentId: string; name: string } | { ok: false; reason: ScanRejectReason };

/**
 * Who holds this card QR right now? The same checks as the gate kiosk (signature, time window, the card's bound phone),
 * for other modules that read a card (the exam room). Records nothing; the caller decides what the card is good for.
 */
export async function verifyCardQr(tx: Tx, schoolId: string, token: string, nowMs: number, timezone: string): Promise<CardCheck> {
  const secret = await schoolSecret(tx, schoolId);
  const check = await verifyCardToken(token, nowMs, timezone, (date) => schoolDayKey(secret, date));
  if (!check.ok) return { ok: false, reason: check.reason };
  const card = await cardForScan(tx, check.cardId);
  if (!card) return { ok: false, reason: 'unknown_card' };
  if (card.activeDeviceId !== check.deviceId) return { ok: false, reason: 'wrong_device' };
  return { ok: true, studentId: card.studentId, name: card.name };
}
