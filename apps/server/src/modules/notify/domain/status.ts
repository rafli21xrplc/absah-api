import { NOTIFICATION_STATUS_RANK, type NotificationStatus } from '@absah/contracts';

/** A provider status update, from any webhook format. */
export interface StatusUpdate {
  providerMessageId: string;
  status: Exclude<NotificationStatus, 'queued'>;
  at: Date;
  error?: string;
}

/**
 * Applies a status update to the current state. The status only moves up in rank (webhooks
 * arrive in any order); the timestamp of each status is kept whenever it arrives.
 */
export function nextStatus(current: NotificationStatus, update: Pick<StatusUpdate, 'status'>): NotificationStatus {
  return NOTIFICATION_STATUS_RANK[update.status] > NOTIFICATION_STATUS_RANK[current] ? update.status : current;
}

const META_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * Status updates from a WhatsApp Cloud API webhook body (entry[].changes[].value.statuses[]).
 * Anything else (incoming messages, unknown statuses) is ignored.
 */
export function parseMetaStatuses(body: unknown): StatusUpdate[] {
  const updates: StatusUpdate[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return updates;
  for (const entry of entries as { changes?: { value?: { statuses?: unknown } }[] }[]) {
    for (const change of entry.changes ?? []) {
      const statuses = change.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: { code?: unknown }[] }[]) {
        if (typeof s.id !== 'string' || typeof s.status !== 'string' || !META_STATUSES.has(s.status)) continue;
        const seconds = Number(s.timestamp);
        const raw = s.errors?.[0]?.code;
        const code = typeof raw === 'number' || typeof raw === 'string' ? raw : undefined;
        updates.push({
          providerMessageId: s.id,
          status: s.status as StatusUpdate['status'],
          at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          ...(code !== undefined ? { error: `wa_${code}` } : {}),
        });
      }
    }
  }
  return updates;
}
