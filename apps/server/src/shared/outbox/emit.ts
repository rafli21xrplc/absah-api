import { schema, type Tx } from '@absah/db';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { currentRequestId } from '../request-id';
import { EVENTS, type EventPayload, type EventType } from './events';

/**
 * Appends an event to the outbox inside the caller's withTenant transaction, so it exists
 * exactly when the change does (rule 3). The school comes from the transaction, not the caller.
 * Returns the event id.
 */
export async function emit<T extends EventType>(tx: Tx, type: T, payload: EventPayload<T>): Promise<string> {
  const parsed: unknown = EVENTS[type].parse(payload);
  const { rows } = await tx.execute<{ school_id: string | null }>(
    sql`select nullif(current_setting('app.school_id', true), '') as school_id`,
  );
  const schoolId = rows[0]?.school_id;
  if (!schoolId) throw new Error('emit() must be called inside withTenant(...)');

  const id = uuidv7();
  // No .returning(): the app role may insert outbox rows but not read them.
  await tx.insert(schema.outboxEvents).values({ id, schoolId, type, payload: parsed, traceId: currentRequestId() ?? null });
  return id;
}
