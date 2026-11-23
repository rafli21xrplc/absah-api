import { schema, type Tx } from '@absah/db';
import { withTenant } from '../db';
import { parseEvent, type EventType, type OutboxEvent } from './events';

/**
 * A reaction to one event type. The handler runs inside withTenant(event.schoolId) with no user,
 * in the same transaction that records the consumption, so a retried job never applies twice.
 * Side effects outside Postgres (WhatsApp, email) must themselves be idempotent per event id.
 */
export interface Consumer<T extends EventType = EventType> {
  /** Stable name: part of the queue name and of the dedup key. Never rename a live consumer. */
  name: string;
  event: T;
  handle(tx: Tx, event: OutboxEvent<T>): Promise<void>;
}

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function defineConsumer<T extends EventType>(consumer: Consumer<T>): Consumer<T> {
  if (!NAME_RE.test(consumer.name)) throw new Error(`consumer name must match ${NAME_RE}: ${consumer.name}`);
  return consumer;
}

/** pg-boss queue of one consumer. */
export function consumerQueue(consumer: Pick<Consumer, 'name' | 'event'>): string {
  return `evt.${consumer.event}.${consumer.name}`;
}

export const OUTBOX_DEAD_LETTER_QUEUE = 'outbox.dead';

/** Runs one delivery. 'duplicate' means this consumer already handled the event. */
export async function runConsumer(consumer: Consumer, data: unknown): Promise<'handled' | 'duplicate'> {
  const event = parseEvent(consumer.event, data);
  return withTenant({ schoolId: event.schoolId, userId: null }, async (tx) => {
    const claimed = await tx
      .insert(schema.outboxConsumptions)
      .values({ consumer: consumer.name, eventId: event.id, schoolId: event.schoolId })
      .onConflictDoNothing()
      .returning({ eventId: schema.outboxConsumptions.eventId });
    if (claimed.length === 0) return 'duplicate';
    await consumer.handle(tx, event);
    return 'handled';
  });
}
