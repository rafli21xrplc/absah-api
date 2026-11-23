import { DEVICE_KEY_DAYS, deviceDayKey, toBase64Url, type BindCardDeviceRequest, type CardDeviceKeys, type CardHolder, type MyCards } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { nextDates } from '../domain/tokens';
import { activeDevice, bindDevice, heldStudents, lockCard } from '../infrastructure/card-repo';
import { dayKeys } from '../infrastructure/gate-secret-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

async function keysFor(tx: Tx, schoolId: string, card: { cardId: string; deviceId: string }, timezone: string, today: string): Promise<CardDeviceKeys> {
  const days = await dayKeys(tx, schoolId, nextDates(today, DEVICE_KEY_DAYS));
  const keys = await Promise.all([...days].map(async ([schoolDate, key]) => ({ schoolDate, key: toBase64Url(await deviceDayKey(key, card.deviceId)) })));
  return { ...card, timezone, keys };
}

export function getMyCards(actor: Actor, holder: CardHolder): Promise<MyCards> {
  return withTenant(scope(actor), async (tx) => ({
    holder,
    items: (await heldStudents(tx, actor.userId, holder)).map((r) => ({ studentId: r.studentId, name: r.name, className: r.className, cardId: r.cardId, hasDevice: r.activeDeviceId !== null })),
  }));
}

/** Binds the caller's phone to a card they hold; the previous phone stops working. */
export function bindCardDevice(actor: Actor, auditCtx: AuditContext, holder: CardHolder, timezone: string, today: string, input: BindCardDeviceRequest): Promise<CardDeviceKeys> {
  return withTenant(scope(actor), async (tx) => {
    const held = (await heldStudents(tx, actor.userId, holder)).some((r) => r.studentId === input.studentId);
    if (!held) throw new NotFoundError('Kartu siswa ini tidak dipegang akun Anda.');
    const card = await lockCard(tx, actor.schoolId, input.studentId);
    const deviceId = uuidv7();
    await bindDevice(tx, card, { deviceId, holder, userId: actor.userId, label: input.label ?? null });
    await audit(tx, auditCtx, 'card.device_bound', { type: 'card', id: card.id }, { before: { deviceId: card.activeDeviceId }, after: { deviceId, holder } });
    return keysFor(tx, actor.schoolId, { cardId: card.id, deviceId }, timezone, today);
  });
}

/** Fresh day keys for a phone that is still the card's bound device. */
export function getDeviceKeys(actor: Actor, timezone: string, today: string, deviceId: string): Promise<CardDeviceKeys> {
  return withTenant(scope(actor), async (tx) => {
    const device = await activeDevice(tx, deviceId);
    if (!device || device.userId !== actor.userId) throw new NotFoundError('HP ini tidak lagi terikat ke kartu. Aktifkan ulang kartu.');
    return keysFor(tx, actor.schoolId, { cardId: device.cardId, deviceId }, timezone, today);
  });
}
